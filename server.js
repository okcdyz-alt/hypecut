// HYPECUT — serveur web (Node.js, sans dépendance externe).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { q } = require('./lib/db');
const auth = require('./lib/auth');
const plans = require('./lib/plans');
const jobs = require('./lib/jobs');
const stripe = require('./lib/stripe');
const cloud = require('./lib/cloudinary');
const ai = require('./lib/ai');
const sources = require('./lib/sources');
const media = require('./lib/media');
const referral = require('./lib/referral');
const ugc = require('./lib/ugc');
const levels = require('./lib/levels');
const revenue = require('./lib/revenue');
const challenge = require('./lib/challenge');
const mail = require('./lib/mail');
const admin = require('./lib/admin');
const library = require('./lib/library');
const Layouts = require('./public/layouts');

const PORT = +process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECURE = PUBLIC_URL.startsWith('https://');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ALLOW_PLATFORMS = process.env.ALLOW_PLATFORM_LINKS !== 'false';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.json': 'application/json' };

let ytdlpOk = false;
media.run(process.env.YTDLP_PATH || 'yt-dlp', ['--version'], { timeoutMs: 10000 }).then(() => (ytdlpOk = true)).catch(() => {});

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
const ok = (res, body, headers) => send(res, 200, body, headers);

async function readBody(req, limit = 1 << 20) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw auth.httpError(413, 'Requête trop volumineuse.'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
async function readJson(req) { const raw = await readBody(req); try { return raw ? JSON.parse(raw) : {}; } catch { throw auth.httpError(400, 'JSON invalide.'); } }

function requireUser(req) { const u = auth.currentUser(req); if (!u) throw auth.httpError(401, 'Connecte-toi pour continuer.'); return u; }
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.headers['true-client-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function userView(u) {
  const p = plans.planOf(u);
  const lv = levels.levelFor(levels.clipCount(u.id));
  return { id: u.id, email: u.email, isAdmin: admin.isAdmin(u), level: { key: lv.key, name: lv.name, emoji: lv.emoji }, plan: p.id, planName: p.name, credits: u.credits, emailOptOut: !!u.email_opt_out, periodEnd: u.period_end, subscribed: !!u.stripe_sub,
    features: { res: Math.min(p.res, +process.env.MAX_EXPORT_RES || 1080), fps: Math.min(p.fps, +process.env.MAX_EXPORT_FPS || 60), watermark: p.watermark, maxDurationMin: p.maxDurationMin, maxUploadMb: p.maxUploadMb, camLayouts: p.camLayouts, effects: !!p.camLayouts, smartCrop: p.smartCrop && cloud.enabled(), batch: p.batch, ai: ai.enabled() ? p.ai : 'none' } };
}

function analysisOptions(src) {
  const clipLen = [15, 30, 45, 60].includes(+src.clipLen) ? +src.clipLen : 30;
  const count = Math.max(1, Math.min(12, +src.count || 5));
  const priority = ['balanced', 'audio', 'action'].includes(src.priority) ? src.priority : 'balanced';
  return { clipLen, count, priority, lang: src.lang === 'en' ? 'en' : 'fr' };
}

function serveFile(req, res, file, cacheSeconds = 0) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Introuvable');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-cache' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] ? +range[1] : st.size - +range[2];
      let end = range[1] && range[2] ? +range[2] : st.size - 1;
      if (!range[1]) end = st.size - 1;
      if (start >= st.size || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function ownJob(user, id) {
  const j = q.get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', id, user.id);
  if (!j) throw auth.httpError(404, 'Analyse introuvable.');
  return j;
}

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

// ---------- Configuration & comptes ----------
route('GET', '/api/health', (req, res) => ok(res, { ok: true }));
route('GET', '/api/config', (req, res) => ok(res, {
  server: true, ...plans.publicPlans(), layouts: Layouts.LAYOUTS,
  services: { cloudinary: cloud.enabled(), ai: ai.enabled(), stripe: stripe.enabled(), platformLinks: ALLOW_PLATFORMS && ytdlpOk },
}));

route('POST', '/api/auth/signup', async (req, res) => {
  if (!auth.rateLimit('signup:' + clientIp(req), 5, 3600e3)) throw auth.httpError(429, 'Trop d’inscriptions depuis ta connexion. Réessaie plus tard.');
  const b = await readJson(req);
  const id = auth.signup(b.email, b.password);
  try { referral.attach(id, b.ref, clientIp(req)); } catch (e) { console.warn('[parrainage]', e.message); }
  mail.event(id, 'welcome', '', { credits: q.get('SELECT credits FROM users WHERE id = ?', id)?.credits ?? 3 });
  ok(res, { user: userView(q.get('SELECT * FROM users WHERE id = ?', id)) }, { 'Set-Cookie': auth.sessionCookie(auth.createSession(id), SECURE) });
});
route('POST', '/api/auth/login', async (req, res) => {
  if (!auth.rateLimit('login:' + clientIp(req), 20, 900e3)) throw auth.httpError(429, 'Trop de tentatives. Réessaie dans quelques minutes.');
  const b = await readJson(req);
  const id = auth.login(b.email, b.password);
  ok(res, { user: userView(q.get('SELECT * FROM users WHERE id = ?', id)) }, { 'Set-Cookie': auth.sessionCookie(auth.createSession(id), SECURE) });
});
route('POST', '/api/auth/logout', (req, res) => {
  auth.destroySession(auth.parseCookies(req)[auth.COOKIE]);
  ok(res, { ok: true }, { 'Set-Cookie': auth.sessionCookie('', SECURE) });
});
route('GET', '/api/me', (req, res) => { const u = auth.currentUser(req); ok(res, { user: u ? userView(u) : null }); });
route('GET', '/api/referral', (req, res) => {
  const u = requireUser(req);
  const st = referral.stats(u.id);
  ok(res, { ...st, link: `${PUBLIC_URL}/?ref=${st.code}`, referred: !!u.referred_by, rewarded: !!u.ref_rewarded });
});
route('POST', '/api/me/emails', async (req, res) => { const u = requireUser(req); mail.setOptOut(u.id, !!(await readJson(req)).optOut); ok(res, { user: userView(q.get('SELECT * FROM users WHERE id = ?', u.id)) }); });
route('GET', '/api/admin/mail', (req, res) => { requireAdmin(req); ok(res, mail.stats()); });
route('POST', '/api/admin/mail/test', async (req, res) => { const a = requireAdmin(req); await mail.test(a); ok(res, { ok: true, to: a.email }); });
// ---------- Tableau de bord des revenus ----------
route('GET', '/api/revenue', (req, res) => { const u = requireUser(req); ok(res, revenue.dashboard(u.id)); });
route('POST', '/api/revenue/currency', async (req, res) => { const u = requireUser(req); revenue.setCurrency(u.id, (await readJson(req)).currency); ok(res, revenue.dashboard(u.id)); });
route('POST', '/api/revenue/campaigns', async (req, res) => { const u = requireUser(req); revenue.saveCampaign(u.id, await readJson(req)); ok(res, revenue.dashboard(u.id)); });
route('POST', '/api/revenue/campaigns/:id', async (req, res, { params }) => { const u = requireUser(req); revenue.saveCampaign(u.id, await readJson(req), params.id); ok(res, revenue.dashboard(u.id)); });
route('DELETE', '/api/revenue/campaigns/:id', (req, res, { params }) => { const u = requireUser(req); revenue.deleteCampaign(u.id, params.id); ok(res, revenue.dashboard(u.id)); });
route('POST', '/api/revenue/posts', async (req, res) => { const u = requireUser(req); revenue.savePost(u.id, await readJson(req)); ok(res, revenue.dashboard(u.id)); });
route('POST', '/api/revenue/posts/:id', async (req, res, { params }) => { const u = requireUser(req); revenue.savePost(u.id, await readJson(req), params.id); ok(res, revenue.dashboard(u.id)); });
route('DELETE', '/api/revenue/posts/:id', (req, res, { params }) => { const u = requireUser(req); revenue.deletePost(u.id, params.id); ok(res, revenue.dashboard(u.id)); });
// ---------- Défi GTA VI de la semaine ----------
route('GET', '/api/challenges', (req, res) => { const u = auth.currentUser(req); ok(res, challenge.overview(u?.id)); });
route('POST', '/api/challenges/:id/entries', async (req, res, { params }) => {
  const u = requireUser(req);
  challenge.enter(u.id, params.id, await readJson(req));
  ok(res, challenge.overview(u.id));
});
// ---------- Programme créateur (crédits contre une vidéo publiée sur HYPECUT) ----------
route('GET', '/api/levels', (req, res) => { const u = requireUser(req); ok(res, levels.forUser(u.id)); });
route('GET', '/api/ugc', (req, res) => { const u = requireUser(req); ok(res, ugc.forUser(u.id)); });
route('POST', '/api/ugc', async (req, res) => {
  const u = requireUser(req);
  const b = await readJson(req);
  ok(res, { submission: await ugc.submit(u.id, b) });
});
route('POST', '/api/ugc/:id/recount', (req, res, { params }) => { const u = requireUser(req); ok(res, { submission: ugc.requestRecount(u.id, params.id) }); });
function requireAdmin(req) { const u = requireUser(req); if (!admin.isAdmin(u)) throw auth.httpError(403, 'Accès réservé.'); return u; }
route('GET', '/api/admin/stats', (req, res) => { requireAdmin(req); ok(res, admin.stats(jobs.queueState)); });
route('GET', '/api/admin/users', (req, res, { url }) => { requireAdmin(req); ok(res, { users: admin.searchUsers(url.searchParams.get('q')) }); });
route('POST', '/api/admin/users/:id', async (req, res, { params }) => {
  const a = requireAdmin(req);
  const b = await readJson(req);
  ok(res, { user: admin.updateUser(params.id, b, a.email) });
});
route('GET', '/api/admin/ugc', (req, res, { url }) => { requireAdmin(req); ok(res, { submissions: ugc.adminList(url.searchParams.get('status') || 'pending'), config: ugc.CFG }); });
route('POST', '/api/admin/ugc/:id', async (req, res, { params }) => {
  const a = requireAdmin(req);
  const b = await readJson(req);
  const sub = ugc.review(params.id, b, a.email);
  if (sub.granted > 0) { const owner = q.get('SELECT user_id FROM ugc_submissions WHERE id = ?', params.id)?.user_id; if (owner) mail.event(owner, 'ugc_approved', `${params.id}:${sub.views}`, sub); }
  ok(res, { submission: sub });
});
route('GET', '/api/admin/challenges', (req, res) => { requireAdmin(req); ok(res, { challenges: challenge.adminList() }); });
route('POST', '/api/admin/challenges', async (req, res) => { requireAdmin(req); challenge.save(await readJson(req)); ok(res, { challenges: challenge.adminList() }); });
route('POST', '/api/admin/challenges/:id', async (req, res, { params }) => { requireAdmin(req); challenge.save(await readJson(req), params.id); ok(res, { challenges: challenge.adminList() }); });
route('DELETE', '/api/admin/challenges/:id', (req, res, { params }) => { requireAdmin(req); challenge.remove(params.id); ok(res, { challenges: challenge.adminList() }); });
route('GET', '/api/admin/challenges/:id/entries', (req, res, { params }) => { requireAdmin(req); ok(res, { entries: challenge.adminEntries(params.id) }); });
route('POST', '/api/admin/entries/:id', async (req, res, { params }) => { requireAdmin(req); challenge.setEntry(params.id, await readJson(req)); ok(res, { ok: true }); });
route('POST', '/api/admin/challenges/:id/award', (req, res, { params }) => {
  const a = requireAdmin(req);
  const paid = challenge.award(params.id, a.email);
  for (const p of paid) mail.event(p.userId, 'challenge_win', params.id, p);
  ok(res, { paid, challenges: challenge.adminList() });
});
route('GET', '/api/backgrounds', (req, res) => { requireUser(req); ok(res, { backgrounds: library.list(false) }); });
route('GET', '/api/admin/backgrounds', (req, res) => { requireAdmin(req); ok(res, { backgrounds: library.list(true) }); });
route('POST', '/api/admin/backgrounds', async (req, res) => {
  requireAdmin(req);
  const b = await readJson(req);
  if (!b.url) throw auth.httpError(400, 'Colle le lien de la vidéo.');
  ok(res, { id: library.add(b) });
});
route('DELETE', '/api/admin/backgrounds/:id', (req, res, { params }) => { requireAdmin(req); library.remove(params.id); ok(res, { ok: true }); });
route('POST', '/api/billing/sync', async (req, res) => {
  const u = requireUser(req);
  if (auth.rateLimit('sync:' + u.id, 20, 3600e3)) await stripe.syncUser(u);
  ok(res, { user: userView(q.get('SELECT * FROM users WHERE id = ?', u.id)) });
});

// ---------- Paiement ----------
route('POST', '/api/billing/checkout', async (req, res) => {
  const u = requireUser(req);
  if (!stripe.enabled()) throw auth.httpError(503, 'Le paiement en ligne arrive très bientôt.');
  const b = await readJson(req);
  if (b.waiver !== true) throw auth.httpError(400, 'Coche la case de demande d’accès immédiat pour continuer.');
  q.run('INSERT INTO ledger(user_id, delta, reason) VALUES(?, 0, ?)', u.id, `renonciation rétractation acceptée (${b.product}) ${new Date().toISOString()}`);
  ok(res, { url: await stripe.checkout(u, b.product, PUBLIC_URL) });
});
route('POST', '/api/billing/portal', async (req, res) => {
  const u = requireUser(req);
  if (!stripe.enabled()) throw auth.httpError(503, 'Le paiement en ligne arrive très bientôt.');
  ok(res, { url: await stripe.portal(u, PUBLIC_URL) });
});
route('POST', '/api/stripe/webhook', async (req, res) => {
  const raw = await readBody(req, 2 << 20);
  if (!stripe.verify(raw, req.headers['stripe-signature'])) return send(res, 400, 'signature invalide');
  await stripe.handleEvent(JSON.parse(raw));
  ok(res, { received: true });
});

// ---------- Analyses ----------
route('POST', '/api/jobs', async (req, res) => {
  const u = requireUser(req);
  if (!auth.rateLimit('job:' + u.id, plans.planOf(u).id === 'free' ? 6 : 40, 3600e3)) throw auth.httpError(429, 'Tu as lancé beaucoup d’analyses : patiente un peu.');
  const b = await readJson(req);
  if (!b.rights) throw auth.httpError(400, 'Confirme que tu as le droit d’utiliser cette vidéo.');
  const src = sources.classify(b.url);
  // Liens acceptés : Twitch et Kick uniquement. Le reste (YouTube compris) passe par l'import de fichier.
  if (!['twitch', 'kick'].includes(src.platform)) throw auth.httpError(400, src.platform === 'youtube'
    ? 'Les liens YouTube ne sont pas acceptés : importe ton fichier vidéo (onglet « Importer un fichier »). Pour ta propre vidéo YouTube, télécharge-la depuis YouTube Studio.'
    : 'Seuls les liens Twitch et Kick sont acceptés. Pour une autre vidéo, importe le fichier (onglet « Importer un fichier »).');
  if (src.platform !== 'direct' && !(ALLOW_PLATFORMS && ytdlpOk)) throw auth.httpError(400, 'Les liens Twitch et Kick sont momentanément indisponibles : importe ton fichier vidéo.');
  if (src.platform === 'direct') await sources.assertPublicHost(src.host);
  const id = jobs.createJob(u, { sourceType: 'url', sourceUrl: src.url, options: analysisOptions(b) });
  jobs.startAnalysis(id, u);
  ok(res, { id });
});

// Envoi de fichier en morceaux (16 Mo) : fiable derrière les proxys, reprise possible en cas de coupure.
const CHUNK_MB = 16;
route('POST', '/api/upload/start', async (req, res) => {
  const u = requireUser(req);
  if (!auth.rateLimit('job:' + u.id, plans.planOf(u).id === 'free' && !plans.planOf(u).launchPass ? 6 : 40, 3600e3)) throw auth.httpError(429, 'Tu as lancé beaucoup d’analyses : patiente un peu.');
  const b = await readJson(req);
  const plan = plans.planOf(u);
  const size = Math.trunc(+b.size || 0);
  if (size <= 0) throw auth.httpError(400, 'Fichier vide.');
  if (size > plan.maxUploadMb * 1048576) throw auth.httpError(413, `Fichier trop lourd pour ton offre (max ${plan.maxUploadMb} Mo).`);
  const name = String(b.name || 'video.mp4').slice(0, 200);
  const ext = (path.extname(name).toLowerCase().match(/^\.(mp4|mov|m4v|webm|mkv|avi|ts|flv)$/) || ['.mp4'])[0];
  const id = jobs.createJob(u, { sourceType: 'upload', title: path.basename(name, path.extname(name)), options: analysisOptions(b) });
  const dest = path.join(jobs.jobDir(id), 'source' + ext);
  fs.closeSync(fs.openSync(dest, 'w'));
  q.run("UPDATE jobs SET status = 'uploading', meta = ? WHERE id = ?", JSON.stringify({ upload: { size, file: 'source' + ext } }), id);
  console.log('[envoi] début', id, `${Math.round(size / 1048576)} Mo`);
  ok(res, { id, chunkSize: CHUNK_MB * 1048576 });
});

function uploadingJob(user, id) {
  const j = ownJob(user, id);
  const up = JSON.parse(j.meta || '{}').upload;
  if (j.status !== 'uploading' || !up) throw auth.httpError(409, 'Cet envoi est déjà terminé ou a expiré.');
  return { j, up, file: path.join(jobs.jobDir(id), up.file) };
}

route('PUT', '/api/upload/:id', async (req, res, { url, params }) => {
  const u = requireUser(req);
  const { up, file } = uploadingJob(u, params.id);
  const offset = Math.trunc(+url.searchParams.get('offset'));
  const have = fs.statSync(file).size;
  if (!(offset >= 0) || offset > have) throw auth.httpError(409, `Morceau hors séquence (reçu jusqu’à ${have}).`);
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > (CHUNK_MB + 1) * 1048576) throw auth.httpError(413, 'Morceau trop gros.'); chunks.push(c); }
  const buf = Buffer.concat(chunks);
  if (offset + buf.length > up.size) throw auth.httpError(400, 'Le fichier dépasse la taille annoncée.');
  const fd = fs.openSync(file, 'r+');
  try { fs.writeSync(fd, buf, 0, buf.length, offset); } finally { fs.closeSync(fd); }
  ok(res, { received: Math.max(have, offset + buf.length) });
});

route('POST', '/api/upload/:id/finish', async (req, res, { params }) => {
  const u = requireUser(req);
  const { j, up, file } = uploadingJob(u, params.id);
  const have = fs.statSync(file).size;
  if (have !== up.size) throw auth.httpError(409, `Envoi incomplet (${have} / ${up.size} octets).`);
  q.run("UPDATE jobs SET status = 'queued', meta = NULL WHERE id = ?", j.id);
  console.log('[envoi] terminé', j.id);
  jobs.startAnalysis(j.id, u);
  ok(res, { id: j.id });
});

route('POST', '/api/upload', (req, res) => {
  req.resume();
  throw auth.httpError(409, 'Le site a été mis à jour : recharge la page (Ctrl+Maj+R ou Cmd+Maj+R) puis relance l’envoi.');
});

route('GET', '/api/jobs', (req, res) => {
  const u = requireUser(req);
  ok(res, { jobs: q.all('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', u.id).map((j) => {
    const v = jobs.jobView(j, false);
    const r = j.result ? JSON.parse(j.result) : null;
    v.clipCount = r?.clips?.length || 0; v.thumb = r?.clips?.[0]?.thumb || null; v.duration = r?.duration || null;
    return v;
  }) });
});
route('GET', '/api/jobs/:id', (req, res, { params }) => {
  const u = requireUser(req);
  const j = ownJob(u, params.id);
  ok(res, { job: jobs.jobView(j), exports: q.all('SELECT * FROM exports WHERE job_id = ? ORDER BY created_at DESC', j.id).map(jobs.exportView), user: userView(u) });
});

// ---------- Exports ----------
function exportOptions(b, clip) {
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const start = Math.max(0, num(b.start, clip.start));
  const end = Math.max(start + 1, Math.min(start + 180, num(b.end, clip.end)));
  const cr = b.camRect && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(+b.camRect[k]))
    ? { x: Math.max(0, Math.min(0.98, +b.camRect.x)), y: Math.max(0, Math.min(0.98, +b.camRect.y)), w: Math.max(0.02, Math.min(1, +b.camRect.w)), h: Math.max(0.02, Math.min(1, +b.camRect.h)) } : null;
  return {
    layout: String(b.layout || 'game_full'), start, end, camRect: cr,
    focusX: Math.max(0, Math.min(1, num(b.focusX, 0.5))), corner: ['tl', 'tr', 'bl', 'br'].includes(b.corner) ? b.corner : 'tl',
    title: b.showTitle === false ? '' : String(b.title || '').slice(0, 90),
    progressBar: b.progressBar === true,
    bgId: typeof b.bgId === 'string' ? b.bgId.slice(0, 64) : null,
  };
}
route('POST', '/api/jobs/:id/export', async (req, res, { params }) => {
  const u = requireUser(req);
  const j = ownJob(u, params.id);
  if (j.status === 'expired') throw auth.httpError(410, 'La vidéo source a expiré : relance l’analyse pour exporter.');
  if (j.status !== 'done') throw auth.httpError(409, 'L’analyse n’est pas terminée.');
  const b = await readJson(req);
  const result = JSON.parse(j.result);
  const idxs = b.all ? result.clips.map((_, i) => i) : [Math.trunc(+b.clipIdx)];
  if (b.all && !plans.planOf(u).batch) throw Object.assign(auth.httpError(402, 'L’export de tous les clips en un clic est inclus dans l’offre Créateur.'), { upgrade: true });
  const ids = [];
  for (const i of idxs) {
    const clip = result.clips[i];
    if (!clip) throw auth.httpError(400, 'Clip introuvable.');
    const fresh = q.get('SELECT * FROM users WHERE id = ?', u.id);
    const opts = exportOptions(b.all ? { ...b, start: clip.start, end: clip.end, title: b.useAiTitles ? clip.ai?.titre || '' : b.title } : b, clip);
    ids.push(jobs.createExport(fresh, j, i, opts));
  }
  ok(res, { ids, user: userView(q.get('SELECT * FROM users WHERE id = ?', u.id)) });
});
route('GET', '/api/exports/:id', (req, res, { params }) => {
  const u = requireUser(req);
  const e = q.get('SELECT * FROM exports WHERE id = ? AND user_id = ?', params.id, u.id);
  if (!e) throw auth.httpError(404, 'Export introuvable.');
  ok(res, { export: jobs.exportView(e) });
});

// ---------- Serveur HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    if (url.pathname.startsWith('/api/')) {
      // Protection CSRF simple : les requêtes qui modifient doivent venir du site lui-même
      if (!['GET', 'HEAD'].includes(req.method) && url.pathname !== '/api/stripe/webhook') {
        const origin = req.headers.origin;
        if (origin && origin !== PUBLIC_URL && !origin.startsWith('http://localhost')) throw auth.httpError(403, 'Origine refusée.');
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (m) return await r.fn(req, res, { url, params: m.groups || {} });
      }
      return send(res, 404, { error: 'Route inconnue' });
    }
    if (url.pathname === '/unsubscribe') {
      const done = mail.unsubscribe(url.searchParams.get('u'), url.searchParams.get('t'));
      if (req.method === 'POST') return send(res, done ? 200 : 400, done ? 'ok' : 'lien invalide');
      return send(res, done ? 200 : 400, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HYPECUT</title></head><body style="font-family:Arial,sans-serif;background:#0a0712;color:#f4f0ff;display:grid;place-items:center;min-height:90vh;text-align:center;padding:20px"><div><h1>${done ? 'C’est noté ✅' : 'Lien invalide'}</h1><p>${done ? 'Tu ne recevras plus nos conseils ni nos annonces de défis. Les e-mails liés à ton compte (gains, résultats) continuent.' : 'Ce lien de désinscription n’est pas valide.'}</p><p><a style="color:#2ee6d6" href="/#compte">Gérer mes e-mails depuis mon compte</a></p></div></body></html>`, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (url.pathname.startsWith('/media/')) {
      const rel = path.normalize(decodeURIComponent(url.pathname.slice(7))).replace(/^(\.\.[/\\])+/, '');
      if (!/^(library\/[\w-]+\.(mp4|jpg)|exports\/[\w-]+\.mp4|[\w-]+\/(thumb_\d+\.jpg|frame\.jpg|preview\.mp4|source\.\w+))$/.test(rel)) return send(res, 404, 'Introuvable');
      return serveFile(req, res, path.join(jobs.MEDIA_DIR, rel), /\.jpg$/.test(rel) ? 86400 : 0);
    }
    let rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '\\') rel = '/index.html';
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Interdit');
    if (!fs.existsSync(file)) return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    return serveFile(req, res, file, 0);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status >= 500 && !e.user ? 'Erreur interne, réessaie.' : e.message, upgrade: !!e.upgrade });
  }
});
server.requestTimeout = 0; // envois de gros fichiers
server.headersTimeout = 60e3;

server.listen(PORT, () => {
  console.log(`HYPECUT en ligne sur ${PUBLIC_URL} (port ${PORT})`);
  console.log(`Services : Cloudinary ${cloud.enabled() ? 'oui' : 'non'} · IA ${ai.enabled() ? 'oui' : 'non'} · Stripe ${stripe.enabled() ? 'oui' : 'non'} · police ${media.FONT || 'aucune'}`);
  stripe.init(PUBLIC_URL);
  console.log(`E-mails : ${mail.enabled() ? 'oui (Brevo)' : 'non (BREVO_API_KEY et MAIL_FROM absents)'}`);
  mail.start();
});

module.exports = server;
