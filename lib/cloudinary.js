// Cloudinary : stockage et diffusion des clips (CDN), recadrage IA qui suit l'action (g_auto).
// Configuration : variable CLOUDINARY_URL = cloudinary://<api_key>:<api_secret>@<cloud_name>
const crypto = require('crypto');
const fs = require('fs');

function config() {
  const raw = process.env.CLOUDINARY_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return { cloud: u.hostname, key: decodeURIComponent(u.username), secret: decodeURIComponent(u.password) };
  } catch { return null; }
}
const enabled = () => !!config();

function sign(params, secret) {
  const str = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== '').sort()
    .map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(str + secret).digest('hex');
}

/** Envoi d'un fichier vidéo (par morceaux de 20 Mo au-delà de 20 Mo). */
async function uploadVideo(file, { folder = 'hypecut', publicId, eager, tags } = {}) {
  const c = config();
  if (!c) throw new Error('Cloudinary non configuré');
  const params = { folder, public_id: publicId, timestamp: Math.floor(Date.now() / 1000), tags };
  if (eager) { params.eager = eager; params.eager_async = 'true'; }
  const signature = sign(params, c.secret);
  const endpoint = `https://api.cloudinary.com/v1_1/${c.cloud}/video/upload`;
  const size = fs.statSync(file).size;
  const CHUNK = 20 * 1024 * 1024;
  const uploadId = crypto.randomBytes(12).toString('hex');
  const fh = await fs.promises.open(file, 'r');
  try {
    let result;
    for (let offset = 0; offset < size; offset += CHUNK) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      const form = new FormData();
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') form.append(k, String(v));
      form.append('api_key', c.key);
      form.append('signature', signature);
      form.append('file', new Blob([buf], { type: 'video/mp4' }), 'clip.mp4');
      const headers = {};
      if (size > CHUNK) { headers['X-Unique-Upload-Id'] = uploadId; headers['Content-Range'] = `bytes ${offset}-${offset + len - 1}/${size}`; }
      const res = await fetch(endpoint, { method: 'POST', body: form, headers, signal: AbortSignal.timeout(10 * 60e3) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Cloudinary : ${j.error?.message || res.status}`);
      result = j;
    }
    return result;
  } finally { await fh.close(); }
}

function deliveryUrl(publicId, transformation, ext = 'mp4') {
  const c = config();
  return `https://res.cloudinary.com/${c.cloud}/video/upload/${transformation ? transformation + '/' : ''}${publicId}.${ext}`;
}

/** Texte pour l_text : encodage URL + double encodage des virgules et barres obliques. */
function encodeText(t) {
  return encodeURIComponent(t).replace(/%2C/g, '%252C').replace(/%2F/g, '%252F');
}

/** Transformation « recadrage IA » 9:16 (+ titre optionnel). */
function smartCropTransformation(res, title) {
  const parts = [`ar_9:16,c_fill,g_auto,w_${res}`];
  if (title) {
    const fs1 = Math.round(res * 0.06);
    parts.push(`b_rgb:000000a0,c_fit,co_white,l_text:Arial_${fs1}_bold:${encodeText(title)},w_${Math.round(res * 0.88)}`);
    parts.push(`fl_layer_apply,g_north,y_${Math.round(res * 16 / 9 * 0.08)}`);
  }
  parts.push('q_auto');
  return parts.join('/');
}

/** Attend qu'une version transformée soit prête (Cloudinary la calcule en arrière-plan). */
async function waitReady(url, timeoutMs = 6 * 60e3) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (r && r.ok) return true;
    await new Promise((s) => setTimeout(s, 5000));
  }
  return false;
}

function attachmentUrl(url, name) {
  const safe = String(name || 'hypecut_clip').normalize('NFD').replace(/[^\w-]+/g, '_').slice(0, 60) || 'hypecut_clip';
  return url.replace('/video/upload/', `/video/upload/fl_attachment:${safe}/`);
}

/** Supprime définitivement une vidéo (et ses versions dérivées) de Cloudinary. */
async function destroyVideo(publicId) {
  const c = config();
  if (!c) throw new Error('Cloudinary non configuré');
  const params = { public_id: publicId, invalidate: 'true', timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  form.append('api_key', c.key);
  form.append('signature', sign(params, c.secret));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${c.cloud}/video/destroy`, { method: 'POST', body: form, signal: AbortSignal.timeout(30e3) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.result !== 'ok' && j.result !== 'not found')) throw new Error(`Cloudinary : ${j.error?.message || j.result || res.status}`);
  return j.result;
}

module.exports = { destroyVideo, enabled, config, uploadVideo, deliveryUrl, smartCropTransformation, waitReady, attachmentUrl, sign, encodeText };
