// Gardien du disque : le disque ne doit JAMAIS se remplir.
// Quand il se remplit, la base SQLite ne peut plus écrire et tout le site tombe (connexion, analyses, exports).
//
// Trois protections :
//  1. Une réserve toujours libre (DISK_RESERVE_MB, 1 Go par défaut) pour la base et les fichiers temporaires.
//  2. Avant chaque téléchargement, envoi ou export : on estime la place nécessaire et on libère d'abord
//     ce qui peut l'être ; si c'est impossible, l'utilisateur reçoit un message clair au lieu d'un plantage.
//  3. Une ronde toutes les 5 min qui garde au moins DISK_TARGET_FREE_PCT % (30 % par défaut) d'espace libre.
//
// Ordre de suppression (du moins utile au plus utile) :
//  0. déchets : fragments de téléchargement, fichiers partiels, sources des analyses en échec ou interrompues,
//     envois abandonnés, fichiers temporaires d'export ;
//  1. clips exportés gardés en local depuis plus de 48 h ;
//  2. vidéos sources des analyses terminées, des plus anciennes aux plus récentes (l'analyse passe « expirée ») ;
//  3. clips exportés gardés en local, des plus anciens aux plus récents.
// Les fichiers d'un traitement en cours ne sont jamais touchés.
const fs = require('fs');
const path = require('path');
const { q, DATA_DIR } = require('./db');

const MB = 1048576;
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const EXPORTS_DIR = path.join(MEDIA_DIR, 'exports');
const RESERVE = (+process.env.DISK_RESERVE_MB || 1024) * MB;
const TARGET_FREE_PCT = Math.min(80, Math.max(5, +process.env.DISK_TARGET_FREE_PCT || 30));
const JUNK = /(-Frag\d+|\.part(-Frag\d+)?|\.ytdl|\.temp|\.tmp|^source_cut\.)/i;
const MEDIA_FILE = /^(source|preview)\b/i;
const UUID = /^[0-9a-f-]{36}$/i;

const userError = (msg) => Object.assign(new Error(msg), { user: true, status: 507 });

function stat() {
  try {
    const s = fs.statfsSync(MEDIA_DIR);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return { total: 0, free: Infinity };
  }
}

function info() {
  const s = stat();
  return {
    totalMb: Math.round(s.total / MB), freeMb: Math.round(s.free / MB),
    freePct: s.total ? Math.round((s.free / s.total) * 100) : 100,
    reserveMb: Math.round(RESERVE / MB), targetFreePct: TARGET_FREE_PCT,
  };
}

const safeStat = (p) => { try { return fs.statSync(p); } catch { return null; } };
const safeList = (d) => { try { return fs.readdirSync(d); } catch { return []; } };

/** Analyses et exports encore en cours : leurs fichiers sont intouchables. */
function busyJobIds(protect = []) {
  const ids = new Set(protect.filter(Boolean));
  for (const j of q.all("SELECT id, status, created_at FROM jobs WHERE status NOT IN ('done','error','expired')")) {
    // Un envoi abandonné depuis plus de 3 h n'est plus considéré comme en cours.
    if (j.status === 'uploading' && Date.parse(String(j.created_at).replace(' ', 'T') + 'Z') < Date.now() - 3 * 3600e3) continue;
    ids.add(j.id);
  }
  for (const e of q.all("SELECT job_id FROM exports WHERE status NOT IN ('done','error')")) ids.add(e.job_id);
  return ids;
}

/** Liste des fichiers supprimables, triés du moins utile au plus utile. */
function candidates(protect) {
  const busy = busyJobIds(protect);
  const now = Date.now();
  const out = [];
  const statusOf = new Map(q.all('SELECT id, status FROM jobs').map((j) => [j.id, j.status]));
  for (const id of safeList(MEDIA_DIR)) {
    if (!UUID.test(id) || busy.has(id)) continue;
    const dir = path.join(MEDIA_DIR, id);
    const status = statusOf.get(id);
    for (const f of safeList(dir)) {
      const p = path.join(dir, f);
      const st = safeStat(p);
      if (!st || !st.isFile()) continue;
      if (JUNK.test(f)) out.push({ p, size: st.size, t: st.mtimeMs, rank: 0 });
      else if (MEDIA_FILE.test(f)) {
        if (status !== 'done') out.push({ p, size: st.size, t: st.mtimeMs, rank: 0 }); // échec, interrompu, expiré, inconnu, envoi abandonné
        else out.push({ p, size: st.size, t: st.mtimeMs, rank: 2, expireJob: id });
      }
    }
  }
  for (const f of safeList(EXPORTS_DIR)) {
    const p = path.join(EXPORTS_DIR, f);
    const st = safeStat(p);
    if (!st) continue;
    const age = now - st.mtimeMs;
    if (st.isDirectory() || /_src\.|\.wav$|\.srt$|\.ass$/i.test(f)) {
      if (age > 3600e3) out.push({ p, size: st.isDirectory() ? 0 : st.size, t: st.mtimeMs, rank: 0, dir: st.isDirectory() });
    } else if (age > 48 * 3600e3) out.push({ p, size: st.size, t: st.mtimeMs, rank: 1 });
    else if (age > 10 * 60e3) out.push({ p, size: st.size, t: st.mtimeMs, rank: 3 });
  }
  return out.sort((a, b) => a.rank - b.rank || a.t - b.t);
}

/** Supprime des fichiers jusqu'à avoir `wantFree` octets libres. Renvoie le nombre d'octets libérés. */
function freeUpTo(wantFree, { protect = [], maxRank = 3 } = {}) {
  let s = stat();
  if (s.free >= wantFree) return 0;
  let freed = 0;
  const expired = new Set();
  for (const c of candidates(protect)) {
    if (c.rank > maxRank) break;
    try { fs.rmSync(c.p, { force: true, recursive: !!c.dir }); freed += c.size; } catch { continue; }
    if (c.expireJob) expired.add(c.expireJob);
    if (stat().free >= wantFree) break;
  }
  for (const id of expired) {
    // Sans sa vidéo source, l'analyse ne peut plus exporter : elle passe « expirée » (message clair côté site).
    const dir = path.join(MEDIA_DIR, id);
    for (const f of safeList(dir)) if (MEDIA_FILE.test(f)) try { fs.rmSync(path.join(dir, f), { force: true }); } catch {}
    q.run("UPDATE jobs SET status = 'expired' WHERE id = ? AND status = 'done'", id);
  }
  s = stat();
  if (freed) console.warn(`[disque] ${Math.round(freed / MB)} Mo libérés · ${Math.round(s.free / MB)} Mo libres sur ${Math.round(s.total / MB)} Mo`);
  return freed;
}

/**
 * À appeler AVANT d'écrire un gros fichier. Libère de la place si besoin.
 * Lève une erreur « utilisateur » (message clair, pas de plantage) si la place manque vraiment.
 */
function ensureFree(bytes, { protect = [], what = 'ce traitement' } = {}) {
  const need = Math.max(0, bytes) + RESERVE;
  const s0 = stat();
  if (s0.free >= need) return;
  // Inutile de tout effacer si, même en supprimant tout ce qui peut l'être, la place manquerait encore
  const possible = candidates(protect).reduce((t, c) => t + c.size, 0);
  if (s0.free + possible >= need) freeUpTo(need, { protect });
  const s = stat();
  if (s.free < need) {
    console.error(`[disque] place insuffisante pour ${what} : ${Math.round(bytes / MB)} Mo demandés, ${Math.round(s.free / MB)} Mo libres`);
    throw userError(`Le serveur manque de place pour ${what} en ce moment (${Math.round(bytes / MB)} Mo nécessaires). Réessaie dans quelques minutes, ou choisis un passage plus court de la vidéo.`);
  }
}

/** Estimation de la taille d'une vidéo téléchargée selon sa durée et sa hauteur. */
function estimateBytes(seconds, height) {
  // Mesuré sur les VOD Twitch réelles : ~0,17 Mo/s en 480p (3 h ≈ 1,8 Go). Marge de 15 %.
  const mbPerSec = height <= 360 ? 0.1 : height <= 480 ? 0.18 : height <= 720 ? 0.42 : 0.85;
  return Math.round((seconds || 600) * mbPerSec * 1.15 * MB + 30 * MB);
}

/** Supprime tout de suite les fichiers lourds d'une analyse qui a échoué. */
function purgeJob(id) {
  const dir = path.join(MEDIA_DIR, id);
  for (const f of safeList(dir)) if (JUNK.test(f) || MEDIA_FILE.test(f)) try { fs.rmSync(path.join(dir, f), { force: true }); } catch {}
}

/** Ronde régulière : déchets toujours supprimés, puis on garde TARGET_FREE_PCT % libres. */
function patrol() {
  try {
    // Les déchets partent toujours, même quand il reste de la place.
    for (const c of candidates([])) {
      if (c.rank !== 0) break;
      try { fs.rmSync(c.p, { force: true, recursive: !!c.dir }); } catch {}
    }
    const s = stat();
    if (s.total) {
      const target = Math.max(RESERVE * 1.5, (s.total * TARGET_FREE_PCT) / 100);
      if (s.free < target) freeUpTo(target);
      const after = stat();
      if (after.free < RESERVE) console.error(`[disque] ALERTE : seulement ${Math.round(after.free / MB)} Mo libres malgré le ménage`);
    }
  } catch (e) { console.error('[disque] ronde', e.message); }
}

function start() {
  setTimeout(patrol, 20e3).unref();
  setInterval(patrol, 5 * 60e3).unref();
}

module.exports = { info, ensureFree, estimateBytes, purgeJob, patrol, freeUpTo, start, RESERVE, MEDIA_DIR };
