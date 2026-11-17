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
  enqueue({ id: jobId, priority: plan.priority, t: Date.now(), fn: () => runAnalysis(jobId, plan) });
}

async function runAnalysis(jobId, plan) {
  const job = q.get('SELECT * FROM jobs WHERE id = ?', jobId);
  const opts = JSON.parse(job.options || '{}');
  const dir = jobDir(jobId);
  const progress = (status, p, message) => setJob(jobId, { status, progress: Math.round(p * 1000) / 1000, message: message || null });
  try {
    let file = job.source_type === 'upload' ? fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => /\/source\./.test(f)) : null;
    if (job.source_type === 'url') {
      const src = sources.classify(job.source_url);
      progress('downloading', 0, src.platform === 'direct' ? 'Téléchargement de la vidéo…' : `Récupération depuis ${sources.platformName(src.platform)}…`);
      if (src.platform === 'direct') {
        file = await sources.downloadDirect(src.url, path.join(dir, 'source.mp4'), { maxBytes: plan.maxUploadMb * 1048576, onProgress: (p) => progress('downloading', p, 'Téléchargement de la vidéo…') });
      } else {
        file = await sources.downloadPlatform(src, path.join(dir, 'source.mp4'), {
          maxDurationSec: plan.maxDurationMin * 60, maxHeight: plan.res,
          onProgress: (p) => progress('downloading', p, 'Récupération de la vidéo…'),
          onInfo: (i) => i.title && setJob(jobId, { title: i.title.slice(0, 200) }),
        });
      }
    }
    if (!file) throw sources.userError('Fichier source introuvable.');
    const info = await media.probe(file);
    if (info.duration > plan.maxDurationMin * 60 + 5) {
      throw sources.userError(`Cette vidéo dure ${Math.round(info.duration / 60)} min : ton offre accepte jusqu’à ${plan.maxDurationMin} min. Passe à une offre supérieure pour les longues VOD.`);
    }
    setJob(jobId, { meta: JSON.stringify({ ...info, file: path.basename(file) }) });

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
    setJob(jobId, { status: 'error', message: e.user ? e.message : 'La vidéo n’a pas pu être analysée. Vérifie le fichier ou le lien et réessaie.' });
  }
}

/** Crée un export (1 crédit, remboursé en cas d'échec). */
function createExport(user, job, clipIdx, options) {
  const plan = planOf(user);
  const L = Layouts.LAYOUTS[options.layout];
  if (!L) throw Object.assign(new Error('Format inconnu.'), { status: 400 });
  if (L.tier === 'pro' && !plan.camLayouts && !(options.layout === 'game_ai' && plan.smartCrop)) {
    throw Object.assign(new Error('Ce format est réservé aux offres Pro et Créateur.'), { status: 402, upgrade: true });
  }
  if (!addCredits(user.id, -1, `export ${job.id}#${clipIdx}`)) {
    throw Object.assign(new Error('Tu n’as plus de crédits. Choisis une offre pour continuer à créer des clips.'), { status: 402, upgrade: true });
  }
  const id = crypto.randomUUID();
  q.run('INSERT INTO exports(id, job_id, user_id, clip_idx, options, status) VALUES(?, ?, ?, ?, ?, ?)', id, job.id, user.id, clipIdx, JSON.stringify(options), 'queued');
  enqueue({ id, priority: plan.priority + 0.5, t: Date.now(), fn: () => runExport(id, plan) });
  return id;
}

async function runExport(exportId, plan) {
  const ex = q.get('SELECT * FROM exports WHERE id = ?', exportId);
  const job = q.get('SELECT * FROM jobs WHERE id = ?', ex.job_id);
  const o = JSON.parse(ex.options);
  const set = (f) => { const k = Object.keys(f); q.run(`UPDATE exports SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, ...k.map((x) => f[x]), exportId); };
  try {
    const meta = JSON.parse(job.meta || '{}');
    const file = path.join(jobDir(job.id), meta.file || '');
    if (!meta.file || !fs.existsSync(file)) throw sources.userError('La vidéo source a expiré : relance l’analyse pour exporter ce clip.');
    set({ status: 'rendering', progress: 0 });
    const res = plan.res, fps = plan.fps;
    const smart = o.layout === 'game_ai' && cloud.enabled();
    const titleLines = !smart && o.title ? Layouts.wrapTitle(o.title, o.layout === 'landscape' ? 34 : o.layout === 'square' ? 24 : 20) : [];
    const out = path.join(MEDIA_DIR, 'exports', `${exportId}.mp4`);
    await media.renderClip(file, meta, o.start, o.end, {
      layout: smart ? 'landscape' : o.layout === 'game_ai' ? 'game_full' : o.layout,
      res: smart ? Math.min(res, meta.height) : res, fps, crf: smart ? 23 : plan.crf,
      camRect: o.camRect, focusX: o.focusX, corner: o.corner, titleLines, watermark: plan.watermark,
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
    set({ status: 'done', progress: 1, url: JSON.stringify({ url, download }) });
  } catch (e) {
    console.error('[export]', exportId, e.message);
    set({ status: 'error', message: e.user ? e.message : 'L’export a échoué. Ton crédit a été remboursé.' });
    addCredits(ex.user_id, 1, `remboursement export ${exportId}`);
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

module.exports = { createJob, startAnalysis, createExport, jobView, exportView, jobDir, MEDIA_DIR };
