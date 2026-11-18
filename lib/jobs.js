// File d'attente des traitements : analyses de vidéos et exports de clips.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { q, addCredits, DATA_DIR } = require('./db');
const { planOf } = require('./plans');
const media = require('./media');
const sources = require('./sources');
const cloud = require('./cloudinary');
const ai = require('./ai');
const titles = require('./titles');
const levels = require('./levels');
const diagnose = require('./diagnose');
const levelBonus = (uid) => { try { return levels.priorityBonus(uid); } catch { return 0; } };
const referral = require('./referral');
const library = require('./library');
const Layouts = require('../public/layouts');

const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(path.join(MEDIA_DIR, 'exports'), { recursive: true });
const MAX_PARALLEL = Math.max(1, +process.env.MAX_PARALLEL_JOBS || 2);
const SOURCE_TTL_H = +process.env.SOURCE_TTL_HOURS || 24;

// Au redémarrage, les traitements en cours sont perdus : on le signale (et on rembourse les exports).
for (const j of q.all("SELECT id FROM jobs WHERE status NOT IN ('done','error','expired')")) {
  q.run("UPDATE jobs SET status = 'error', message = 'Traitement interrompu par une mise à jour du serveur. Relance-le.' WHERE id = ?", j.id);
}
for (const e of q.all("SELECT id, user_id FROM exports WHERE status NOT IN ('done','error')")) {
  q.run("UPDATE exports SET status = 'error', message = 'Export interrompu, crédit remboursé.' WHERE id = ?", e.id);
  addCredits(e.user_id, 1, 'remboursement (redémarrage)');
}

const queue = [];
let running = 0;
function enqueue(task) {
  queue.push(task);
  queue.sort((a, b) => b.priority - a.priority || a.t - b.t);
  pump();
}
function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const task = queue.shift();
    running++;
    task.fn().catch((e) => console.error('[job]', e)).finally(() => { running--; pump(); });
  }
}
const queuePosition = (id) => queue.findIndex((t) => t.id === id) + 1;

const jobDir = (id) => path.join(MEDIA_DIR, id);
const setJob = (id, fields) => {
  const keys = Object.keys(fields);
  q.run(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]), id);
};

function createJob(user, { sourceType, sourceUrl, title, options }) {
  const id = crypto.randomUUID();
  fs.mkdirSync(jobDir(id), { recursive: true });
  q.run('INSERT INTO jobs(id, user_id, status, source_type, source_url, title, options) VALUES(?, ?, ?, ?, ?, ?, ?)',
    id, user.id, 'queued', sourceType, sourceUrl || null, title || null, JSON.stringify(options));
  return id;
}

function startAnalysis(jobId, user) {
  const plan = planOf(user);
  enqueue({ id: jobId, priority: plan.priority + levelBonus(user.id), t: Date.now(), fn: () => runAnalysis(jobId, plan) });
}

async function runAnalysis(jobId, plan) {
  const job = q.get('SELECT * FROM jobs WHERE id = ?', jobId);
  const opts = JSON.parse(job.options || '{}');
  const dir = jobDir(jobId);
  const progress = (status, p, message) => setJob(jobId, { status, progress: Math.round(p * 1000) / 1000, message: message || null });
  try {
    let dl = null;
    let file = job.source_type === 'upload' ? fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => /\/source\./.test(f)) : null;
    if (job.source_type === 'url') {
      const src = sources.classify(job.source_url);
      progress('downloading', 0, src.platform === 'direct' ? 'Téléchargement de la vidéo…' : `Récupération depuis ${sources.platformName(src.platform)}…`);
      if (src.platform === 'direct') {
        file = await sources.downloadDirect(src.url, path.join(dir, 'source.mp4'), { maxBytes: plan.maxUploadMb * 1048576, onProgress: (p) => progress('downloading', p, 'Téléchargement de la vidéo…') });
      } else {
        dl = await sources.downloadPlatform(src, path.join(dir, 'source.mp4'), {
          maxDurationSec: plan.maxDurationMin * 60, maxHeight: plan.res,
          proxyHeight: +process.env.PROXY_HEIGHT || 480, proxyAfterSec: +process.env.PROXY_AFTER_SEC || 1800,
          onProgress: (p) => progress('downloading', p, 'Récupération de la vidéo…'),
          onInfo: (i) => i.title && setJob(jobId, { title: i.title.slice(0, 200) }),
          tooLong: (d) => diagnose.tooLong(d, plan, src.platform), range: opts.range,
        });
        file = dl.file;
      }
    }
    if (!file) throw sources.userError('Fichier source introuvable.');
    // Fichier importé + passage choisi : on coupe le passage avant l'analyse
    if (job.source_type === 'upload' && opts.range) {
      const full = await media.probe(file).catch((e) => { throw diagnose.unreadableFile(e); });
      if (opts.range.start >= full.duration - 1) throw sources.userError(`Le début du passage (${diagnose.clock(opts.range.start)}) est après la fin de la vidéo, qui dure ${diagnose.clock(full.duration)}.`);
      const end = Math.min(opts.range.end ?? full.duration, full.duration, opts.range.start + plan.maxDurationMin * 60);
      progress('downloading', 1, 'Découpe du passage choisi…');
      const cut = path.join(dir, 'source_cut.mp4');
      await media.run(media.FFMPEG, ['-v', 'error', '-y', '-ss', String(opts.range.start), '-to', String(end), '-i', file, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', cut], { timeoutMs: 20 * 60e3 });
      fs.rm(file, { force: true }, () => {});
      file = cut;
    }
    let info;
    try { info = await media.probe(file); } catch (e) { throw job.source_type === 'upload' ? diagnose.unreadableFile(e) : e; }
    if (!info.duration || !info.width) throw job.source_type === 'upload' ? diagnose.unreadableFile(new Error('pas de piste vidéo')) : sources.userError(diagnose.unexpected('url'));
    if (info.duration > plan.maxDurationMin * 60 + 5) throw diagnose.tooLong(info.duration, plan, job.source_type === 'url' ? sources.classify(job.source_url).platform : 'upload');
    // Version légère d'une longue VOD : on retient où retrouver la pleine qualité pour les exports
    const proxyMeta = dl && dl.proxy ? { proxy: true, srcUrl: dl.url, offset: dl.offset } : {};
    setJob(jobId, { meta: JSON.stringify({ ...info, file: path.basename(file), ...proxyMeta }) });
    if (dl && dl.proxy) console.log('[analyse] version légère', jobId, `${info.width}x${info.height}`);

    progress('analyzing', 0, 'Écoute du son et analyse des images…');
    const t0 = Date.now();
    console.log('[analyse] début', jobId, `${Math.round(info.duration)} s`, `${info.width}x${info.height}`, info.vcodec);
    const r = await media.analyze(file, info, opts, (p) => progress('analyzing', p, 'Écoute du son et analyse des images…'));

    console.log('[analyse] fin', jobId, `${Math.round((Date.now() - t0) / 1000)} s`, `${r.clips.length} clips`);
    progress('thumbs', 0, 'Préparation des aperçus…');
    for (let i = 0; i < r.clips.length; i++) {
      const c = r.clips[i];
      await media.thumbnail(file, c.peak, path.join(dir, `thumb_${i}.jpg`), 480);
      await media.thumbnail(file, c.start + (c.peak - c.start) * 0.4, path.join(dir, `pre_${i}.jpg`), 640);
      c.thumb = `/media/${jobId}/thumb_${i}.jpg`;
      progress('thumbs', (i + 1) / r.clips.length, 'Préparation des aperçus…');
    }
    // Image plein cadre pour encadrer la caméra du streamer
    await media.thumbnail(file, r.clips[0]?.peak || info.duration / 2, path.join(dir, 'frame.jpg'), Math.min(1280, info.width));

    let previewUrl = `/media/${jobId}/${path.basename(file)}`;
    if (!info.browserFriendly) {
      progress('preview', 0, 'Préparation du lecteur…');
      await media.makePreview(file, path.join(dir, 'preview.mp4'), (p) => progress('preview', p, 'Préparation du lecteur…'), info.duration);
      previewUrl = `/media/${jobId}/preview.mp4`;
    }

    titles.suggest(r.clips, jobId, opts.lang); // titres gratuits (remplacés par l'IA si une clé est configurée)
    if (ai.enabled() && plan.ai !== 'none') {
      const n = plan.ai === 'top1' ? Math.min(1, r.clips.length) : r.clips.length;
      for (let i = 0; i < n; i++) {
        progress('ai', i / n, 'L’IA écrit les titres…');
        const c = r.clips[i];
        try {
          c.ai = await ai.describeClip({ frames: [path.join(dir, `pre_${i}.jpg`), path.join(dir, `thumb_${i}.jpg`)], reasons: c.reasons, hype: c.hype, duration: c.end - c.start, context: job.title });
        } catch (e) { console.warn('[ai]', e.message); }
      }
    }

    setJob(jobId, {
      status: 'done', progress: 1, message: null,
      result: JSON.stringify({ duration: info.duration, step: r.step, series: r.series, clips: r.clips, width: info.width, height: info.height, previewUrl, frameUrl: `/media/${jobId}/frame.jpg` }),
    });
  } catch (e) {
    console.error('[analyse]', jobId, e.message);
    setJob(jobId, { status: 'error', message: e.user ? e.message : diagnose.unexpected(job.source_type) });
  }
}

/** Crée un export (1 crédit, remboursé en cas d'échec). */
function createExport(user, job, clipIdx, options) {
  const plan = planOf(user);
  const L = Layouts.LAYOUTS[options.layout];
  if (!L) throw Object.assign(new Error('Format inconnu.'), { status: 400 });
  if (L.bg && !library.get(options.bgId)) throw Object.assign(new Error('Choisis une vidéo satisfaisante pour le bas de l’écran.'), { status: 400 });
  if (L.tier === 'pro' && !plan.camLayouts && !(options.layout === 'game_ai' && plan.smartCrop)) {
    throw Object.assign(new Error('Ce format est réservé aux offres Pro et Créateur.'), { status: 402, upgrade: true });
  }
  if (!addCredits(user.id, -1, `export ${job.id}#${clipIdx}`)) {
    throw Object.assign(new Error('Tu n’as plus de crédits. Choisis une offre pour continuer à créer des clips.'), { status: 402, upgrade: true });
  }
  const id = crypto.randomUUID();
  q.run('INSERT INTO exports(id, job_id, user_id, clip_idx, options, status) VALUES(?, ?, ?, ?, ?, ?)', id, job.id, user.id, clipIdx, JSON.stringify(options), 'queued');
  enqueue({ id, priority: plan.priority + 0.5 + levelBonus(user.id), t: Date.now(), fn: () => runExport(id, plan) });
  return id;
}

async function runExport(exportId, plan) {
  let segFile = null;
  const ex = q.get('SELECT * FROM exports WHERE id = ?', exportId);
  const job = q.get('SELECT * FROM jobs WHERE id = ?', ex.job_id);
  const o = JSON.parse(ex.options);
  const set = (f) => { const k = Object.keys(f); q.run(`UPDATE exports SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, ...k.map((x) => f[x]), exportId); };
  try {
    const meta = JSON.parse(job.meta || '{}');
    let file = path.join(jobDir(job.id), meta.file || '');
    const canRefetch = !!(meta.proxy && meta.srcUrl);
    if (!meta.file || (!fs.existsSync(file) && !canRefetch)) throw sources.userError('La vidéo source a expiré : relance l’analyse pour exporter ce clip.');
    const maxRes0 = +process.env.MAX_EXPORT_RES || 1080;
    // Longue VOD analysée en version légère : on retélécharge juste ce passage en pleine qualité
    let m = meta, start = o.start, end = o.end, fetchNote = null;
    if (meta.proxy && meta.srcUrl) {
      set({ status: 'fetching', progress: 0.01 });
      const a = Math.max(0, (meta.offset || 0) + o.start - 2), b = (meta.offset || 0) + o.end + 2;
      try {
        const seg = await sources.downloadSegment(meta.srcUrl, a, b, path.join(MEDIA_DIR, 'exports', `${exportId}_src.mp4`), Math.min(plan.res, maxRes0));
        const sm = await media.probe(seg);
        segFile = seg; file = seg; m = sm; start = (meta.offset || 0) + o.start - a; end = start + (o.end - o.start);
      } catch (e) {
        console.warn('[export] passage pleine qualité indisponible', exportId, e.message);
        if (!fs.existsSync(file)) throw sources.userError('Cette VOD n’est plus accessible sur la plateforme : impossible de récupérer ce passage. Relance l’analyse si la vidéo est de nouveau en ligne.');
        fetchNote = 'La VOD n’est plus accessible en pleine qualité : clip exporté depuis la version d’analyse (qualité réduite).';
      }
    }
    set({ status: 'rendering', progress: 0.05 });
    // Qualité : jamais au-dessus de l'offre, de la source, ni des limites du serveur
    const maxRes = +process.env.MAX_EXPORT_RES || 1080, maxFps = +process.env.MAX_EXPORT_FPS || 60;
    const srcShort = Math.min(m.width || 1080, m.height || 1080);
    const res = Math.max(480, Math.round(Math.min(plan.res, maxRes, Math.max(540, srcShort * 1.125)) / 2) * 2);
    const fps = Math.min(plan.fps, maxFps, Math.round(m.fps || 30)) >= 50 ? 60 : 30;
    const smart = o.layout === 'game_ai' && cloud.enabled();
    const titleLines = !smart && o.title ? Layouts.wrapTitle(o.title, o.layout === 'landscape' ? 34 : o.layout === 'square' ? 24 : 20) : [];
    const out = path.join(MEDIA_DIR, 'exports', `${exportId}.mp4`);
    // Sous-titres automatiques (offres Pro et Créateur) : transcription de l'extrait avant le montage
    let subtitleWords = null, note = null;
    if (o.subtitles && plan.camLayouts) {
      if (smart) note = 'Les sous-titres ne sont pas disponibles avec le recadrage IA : clip exporté sans sous-titres.';
      else {
        set({ status: 'subtitles', progress: 0.02 });
        try {
          subtitleWords = await require('./subtitles').transcribe(file, start, end, path.join(MEDIA_DIR, 'exports', exportId));
          if (!subtitleWords.length) note = 'Aucune parole détectée dans ce passage : clip exporté sans sous-titres.';
        } catch (e) {
          console.warn('[sous-titres]', exportId, e.message);
          note = 'Les sous-titres n’ont pas pu être générés pour ce clip (le reste est prêt).';
        }
      }
    }
    await media.renderClip(file, m, start, end, {
      subtitleWords, titlePos: o.titlePos, subPos: o.subPos,
      layout: smart ? 'landscape' : o.layout === 'game_ai' ? 'game_full' : o.layout,
      res: smart ? Math.min(res, m.height) : res, fps, crf: smart ? 23 : plan.crf,
      camRect: o.camRect, focusX: o.focusX, corner: o.corner, titleLines, watermark: plan.watermark,
      progressBar: !!o.progressBar && !!plan.camLayouts,
      bg: o.bgId ? library.get(o.bgId) : null,
    }, out, (p) => set({ progress: Math.round(p * 0.85 * 1000) / 1000 }));

    let url = `/media/exports/${exportId}.mp4`, download = url;
    // Cloudinary (offre gratuite) refuse les vidéos de plus de 100 Mo : au-delà, le clip est servi par notre serveur.
    const fitsCloud = fs.statSync(out).size < (+process.env.CLOUDINARY_MAX_MB || 95) * 1048576;
    if (smart && !fitsCloud) throw sources.userError('Clip trop lourd pour le recadrage IA : raccourcis-le ou choisis « Jeu plein écran ».');
    if (cloud.enabled() && fitsCloud) {
      set({ status: 'uploading', progress: 0.88 });
      const eager = smart ? cloud.smartCropTransformation(res, o.title ? Layouts.wrapTitle(o.title, 60).join(' ') : '') : undefined;
      const up = await cloud.uploadVideo(out, { folder: 'hypecut/exports', publicId: exportId, eager, tags: `hypecut,${o.layout}` });
      url = smart ? cloud.deliveryUrl(up.public_id, eager) : up.secure_url;
      if (smart) {
        set({ status: 'ai_crop', progress: 0.92 });
        if (!(await cloud.waitReady(url))) throw new Error('Le recadrage IA a pris trop de temps.');
      }
      download = cloud.attachmentUrl(url, o.title || 'hypecut_clip');
      fs.rm(out, { force: true }, () => {});
    }
    set({ status: 'done', progress: 1, message: [fetchNote, note].filter(Boolean).join(' ') || null, url: JSON.stringify({ url, download }) });
    try { referral.rewardIfFirstExport(ex.user_id); } catch (e) { console.warn('[parrainage]', e.message); }
    try { const up = levels.checkLevelUp(ex.user_id); if (up) require('./mail').event(ex.user_id, 'level_up', up.key, { level: up }); } catch (e) { console.warn('[niveaux]', e.message); }
  } catch (e) {
    console.error('[export]', exportId, e.message);
    set({ status: 'error', message: e.user ? e.message : 'L’export a échoué, ton crédit a été remboursé. Causes possibles :\n• le serveur a redémarré pendant l’export (mise à jour du site) ;\n• un problème d’encodage sur ce passage de la vidéo ;\n• la vidéo source n’est plus disponible sur le serveur.\nRéessaie ; si ça recommence, choisis un autre format ou relance l’analyse.' });
    addCredits(ex.user_id, 1, `remboursement export ${exportId}`);
  } finally {
    if (segFile) fs.rm(segFile, { force: true }, () => {});
  }
}

function exportView(e) {
  const u = e.url ? JSON.parse(e.url) : null;
  return { id: e.id, clipIdx: e.clip_idx, status: e.status, progress: e.progress, message: e.message, url: u?.url || null, download: u?.download || null, options: JSON.parse(e.options || '{}'), queue: queuePosition(e.id) };
}

function jobView(j, withResult = true) {
  return {
    id: j.id, status: j.status, progress: j.progress, message: j.message, title: j.title,
    sourceType: j.source_type, sourceUrl: j.source_type === 'url' ? j.source_url : null, createdAt: j.created_at,
    queue: queuePosition(j.id),
    result: withResult && j.result ? JSON.parse(j.result) : null,
  };
}

// Ménage : sources supprimées après SOURCE_TTL_HOURS, exports locaux après 7 jours.
function cleanup() {
  const old = q.all(`SELECT id FROM jobs WHERE created_at < datetime('now', ?) AND status != 'expired'`, `-${SOURCE_TTL_H} hours`);
  for (const j of old) {
    const dir = jobDir(j.id);
    try {
      for (const f of fs.readdirSync(dir)) if (/^(source|preview)\./.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    } catch {}
    q.run("UPDATE jobs SET status = CASE WHEN status = 'done' THEN 'expired' ELSE status END WHERE id = ?", j.id);
  }
  const exDir = path.join(MEDIA_DIR, 'exports');
  for (const f of fs.readdirSync(exDir)) {
    const p = path.join(exDir, f);
    try { if (Date.now() - fs.statSync(p).mtimeMs > 7 * 86400e3) fs.rmSync(p, { force: true }); } catch {}
  }
}
setInterval(cleanup, 3600e3).unref();
setTimeout(cleanup, 60e3).unref();

const queueState = () => ({ waiting: queue.length, running, max: MAX_PARALLEL });

module.exports = { createJob, startAnalysis, createExport, jobView, exportView, jobDir, MEDIA_DIR, queueState };
