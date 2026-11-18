// Bibliothèque de vidéos de fond « satisfaisantes » (libres de droits), gérée par l'admin.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { q, DATA_DIR } = require('./db');
const media = require('./media');
const sources = require('./sources');

const DIR = path.join(DATA_DIR, 'media', 'library');
fs.mkdirSync(DIR, { recursive: true });
const MAX_SEC = 60;

// Une page Pexels (pexels.com/video/nom-123456/) devient son lien de téléchargement direct
function normalizeUrl(raw) {
  const u = String(raw || '').trim();
  const m = u.match(/pexels\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:video|videos)\/(?:[^/?#]*?-)?(\d{4,})\/?/i);
  if (m && !/\/download\//.test(u)) return `https://www.pexels.com/download/video/${m[1]}/`;
  return u;
}

const fileOf = (id) => path.join(DIR, `${id}.mp4`);
const thumbOf = (id) => path.join(DIR, `${id}.jpg`);

function list(all) {
  return q.all(`SELECT * FROM backgrounds WHERE active = 1 ${all ? '' : "AND status = 'ready'"} ORDER BY created_at DESC`).map((b) => ({
    id: b.id, name: b.name, source: b.source, status: b.status, message: b.message, duration: b.duration,
    thumb: b.status === 'ready' ? `/media/library/${b.id}.jpg` : null, preview: b.status === 'ready' ? `/media/library/${b.id}.mp4` : null,
  }));
}

function get(id) {
  const b = q.get("SELECT * FROM backgrounds WHERE id = ? AND active = 1 AND status = 'ready'", id);
  return b && fs.existsSync(fileOf(b.id)) ? { ...b, file: fileOf(b.id) } : null;
}

function add({ url, name, source }) {
  const clean = normalizeUrl(url);
  sources.classify(clean); // valide le format du lien
  const id = crypto.randomUUID();
  q.run('INSERT INTO backgrounds(id, name, source, url) VALUES(?, ?, ?, ?)', id, String(name || 'Vidéo satisfaisante').slice(0, 60), String(source || '').slice(0, 120), clean);
  processBg(id, clean).catch(() => {});
  return id;
}

async function processBg(id, url) {
  const raw = path.join(DIR, `${id}.source`);
  try {
    await sources.downloadDirect(url, raw, { maxBytes: 600 * 1048576 });
    const info = await media.probe(raw);
    // Version légère : 720 px de haut max, sans son, 60 s max (elle tourne en boucle sous le clip)
    await media.run(media.FFMPEG, ['-v', 'error', '-y', '-i', raw, '-t', String(MAX_SEC), '-an',
      '-vf', "scale=-2:'min(720,ih)':flags=bicubic,fps=30,format=yuv420p", '-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
      '-movflags', '+faststart', fileOf(id)], { timeoutMs: 10 * 60e3 });
    const out = await media.probe(fileOf(id));
    await media.thumbnail(fileOf(id), Math.min(2, out.duration / 2), thumbOf(id), 360);
    q.run("UPDATE backgrounds SET status = 'ready', width = ?, height = ?, duration = ?, message = NULL WHERE id = ?", out.width, out.height, out.duration, id);
    console.log('[bibliothèque] prête', id, info.width + 'x' + info.height);
  } catch (e) {
    console.warn('[bibliothèque] échec', id, e.message);
    q.run("UPDATE backgrounds SET status = 'error', message = ? WHERE id = ?", e.user ? e.message : 'Téléchargement ou conversion impossible. Vérifie que le lien mène bien à un fichier vidéo.', id);
  } finally {
    fs.rm(raw, { force: true }, () => {});
  }
}

function remove(id) {
  q.run('UPDATE backgrounds SET active = 0 WHERE id = ?', id);
  for (const f of [fileOf(id), thumbOf(id)]) fs.rm(f, { force: true }, () => {});
}

module.exports = { list, get, add, remove, normalizeUrl, DIR };
