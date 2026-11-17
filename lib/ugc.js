// Programme créateur : l'utilisateur publie une vidéo qui présente HYPECUT (TikTok ou Reels),
// envoie le lien, l'admin vérifie la vidéo et ses vues, et des crédits sont versés selon les vues.
// Pas de récompense contre un abonnement ou un like : Instagram et TikTok l'interdisent.
const crypto = require('crypto');
const { db, q, addCredits } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS ugc_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  views INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  recount_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ugc_url_key ON ugc_submissions(url_key);
CREATE INDEX IF NOT EXISTS ugc_user ON ugc_submissions(user_id, created_at);
CREATE INDEX IF NOT EXISTS ugc_status ON ugc_submissions(status, created_at);
`);

const num = (v, d) => (Number.isFinite(+v) && +v >= 0 ? +v : d);
const CFG = {
  per1000: num(process.env.UGC_CREDITS_PER_1000_VIEWS, 1), // crédits pour 1 000 vues
  minViews: num(process.env.UGC_MIN_VIEWS, 1000),          // en dessous : pas de crédits
  maxPerVideo: num(process.env.UGC_MAX_PER_VIDEO, 50),     // plafond par vidéo
  maxPerMonth: num(process.env.UGC_MAX_PER_MONTH, 150),    // plafond par compte sur 30 jours
  maxPending: num(process.env.UGC_MAX_PENDING, 3),         // vidéos en attente en même temps
  recountDays: num(process.env.UGC_RECOUNT_DAYS, 3),       // délai avant de redemander un comptage
};
const REASON = 'programme créateur';
const err = (status, message) => Object.assign(new Error(message), { status });

/** Reconnaît un lien TikTok ou Instagram et en tire une clé unique (même vidéo = même clé). */
function parseUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  let m;
  if (host === 'tiktok.com' && (m = path.match(/^\/@[\w.-]+\/(?:video|photo)\/(\d{5,25})$/))) return { platform: 'tiktok', key: `tiktok:${m[1]}`, url: `https://www.tiktok.com${path}` };
  if ((host === 'vm.tiktok.com' || host === 'vt.tiktok.com') && (m = path.match(/^\/([\w-]{4,20})$/))) return { platform: 'tiktok', key: `tiktok-short:${m[1]}`, url: `https://${host}${path}/`, short: true };
  if (host === 'tiktok.com' && (m = path.match(/^\/t\/([\w-]{4,20})$/))) return { platform: 'tiktok', key: `tiktok-short:${m[1]}`, url: `https://www.tiktok.com${path}/`, short: true };
  if (host === 'instagram.com' && (m = path.match(/^(?:\/[\w.]+)?\/(?:reel|reels|p)\/([\w-]{5,40})$/))) return { platform: 'instagram', key: `instagram:${m[1]}`, url: `https://www.instagram.com/reel/${m[1]}/` };
  return null;
}

/** Lien court TikTok (vm.tiktok.com/…) : on suit la redirection pour retrouver l'identifiant de la vidéo. */
async function resolveShort(p) {
  if (!p.short) return p;
  try {
    const r = await fetch(p.url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    const loc = r.headers.get('location');
    const full = loc && parseUrl(new URL(loc, p.url).href.split('?')[0]);
    if (full && !full.short) return full;
  } catch { /* on garde le lien court */ }
  return p;
}

/** Crédits dus pour un nombre de vues (avant plafond mensuel). */
function creditsFor(views) {
  if (views < CFG.minViews) return 0;
  return Math.min(CFG.maxPerVideo, Math.floor((views / 1000) * CFG.per1000));
}
function earnedLast30(userId) {
  return q.get(`SELECT COALESCE(SUM(delta), 0) AS n FROM ledger WHERE user_id = ? AND reason LIKE '${REASON}%' AND delta > 0 AND created_at > datetime('now', '-30 days')`, userId).n;
}

function view(s) {
  return { id: s.id, url: s.url, platform: s.platform, status: s.status, views: s.views, credits: s.credits, note: s.note, createdAt: s.created_at, reviewedAt: s.reviewed_at,
    canRecount: s.status === 'approved' && s.credits < CFG.maxPerVideo && (!s.reviewed_at || Date.parse(s.reviewed_at.replace(' ', 'T') + 'Z') < Date.now() - CFG.recountDays * 86400e3) };
}

function forUser(userId) {
  const list = q.all('SELECT * FROM ugc_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', userId).map(view);
  const earned = q.get(`SELECT COALESCE(SUM(delta), 0) AS n FROM ledger WHERE user_id = ? AND reason LIKE '${REASON}%'`, userId).n;
  return { config: { ...CFG }, submissions: list, earned, earnedMonth: earnedLast30(userId) };
}

async function submit(userId, { url, accept }) {
  if (!accept) throw err(400, 'Coche la case pour confirmer que ta vidéo respecte les règles du programme.');
  let p = parseUrl(url);
  if (!p) throw err(400, 'Colle le lien d’une vidéo TikTok ou d’un Reel Instagram (par exemple https://www.tiktok.com/@toncompte/video/…).');
  p = await resolveShort(p);
  const pending = q.get("SELECT COUNT(*) AS n FROM ugc_submissions WHERE user_id = ? AND status = 'pending'", userId).n;
  if (pending >= CFG.maxPending) throw err(429, `Tu as déjà ${pending} vidéos en attente de vérification. Attends qu’elles soient vérifiées pour en envoyer d’autres.`);
  if (q.get('SELECT id FROM ugc_submissions WHERE url_key = ?', p.key)) throw err(409, 'Cette vidéo a déjà été envoyée.');
  const id = crypto.randomBytes(8).toString('hex');
  q.run('INSERT INTO ugc_submissions(id, user_id, url, url_key, platform) VALUES(?, ?, ?, ?, ?)', id, userId, p.url, p.key, p.platform);
  return view(q.get('SELECT * FROM ugc_submissions WHERE id = ?', id));
}

function requestRecount(userId, id) {
  const s = q.get('SELECT * FROM ugc_submissions WHERE id = ? AND user_id = ?', id, userId);
  if (!s) throw err(404, 'Vidéo introuvable.');
  if (!view(s).canRecount) throw err(400, `Tu pourras redemander un comptage ${CFG.recountDays} jours après la dernière vérification.`);
  q.run("UPDATE ugc_submissions SET status = 'pending', recount_at = datetime('now') WHERE id = ?", id);
  return view(q.get('SELECT * FROM ugc_submissions WHERE id = ?', id));
}

// ---------- admin ----------
function adminList(status) {
  const where = ['pending', 'approved', 'rejected'].includes(status) ? 'WHERE s.status = ?' : '';
  const args = where ? [status] : [];
  return q.all(`SELECT s.*, u.email FROM ugc_submissions s JOIN users u ON u.id = s.user_id ${where} ORDER BY s.recount_at IS NULL, COALESCE(s.recount_at, s.created_at) ASC LIMIT 100`, ...args)
    .map((s) => ({ ...view(s), email: s.email, recount: !!s.recount_at && s.status === 'pending', earnedMonth: earnedLast30(s.user_id) }));
}
const pendingCount = () => q.get("SELECT COUNT(*) AS n FROM ugc_submissions WHERE status = 'pending'").n;

/** Valide (avec le nombre de vues constaté) ou refuse une vidéo. Ne verse que la différence avec ce qui a déjà été donné. */
function review(id, { approve, views, note }, adminEmail) {
  const s = q.get('SELECT * FROM ugc_submissions WHERE id = ?', id);
  if (!s) throw err(404, 'Vidéo introuvable.');
  note = String(note || '').trim().slice(0, 300) || null;
  if (!approve) {
    q.run("UPDATE ugc_submissions SET status = 'rejected', note = ?, reviewed_at = datetime('now') WHERE id = ?", note || 'Vidéo non conforme au programme.', id);
    return { ...view(q.get('SELECT * FROM ugc_submissions WHERE id = ?', id)), granted: 0 };
  }
  views = Math.trunc(+views);
  if (!Number.isFinite(views) || views < 0 || views > 1e9) throw err(400, 'Indique le nombre de vues de la vidéo.');
  views = Math.max(views, s.views); // les vues ne redescendent pas
  const due = creditsFor(views);
  let grant = Math.max(0, due - s.credits);
  const room = Math.max(0, CFG.maxPerMonth - earnedLast30(s.user_id));
  grant = Math.min(grant, room);
  if (grant > 0) addCredits(s.user_id, grant, `${REASON} : vidéo ${id} (${views} vues, validé par ${adminEmail})`);
  q.run("UPDATE ugc_submissions SET status = 'approved', views = ?, credits = credits + ?, note = ?, reviewed_at = datetime('now'), recount_at = NULL WHERE id = ?", views, grant, note, id);
  return { ...view(q.get('SELECT * FROM ugc_submissions WHERE id = ?', id)), granted: grant, capped: grant < Math.max(0, due - s.credits) };
}

module.exports = { CFG, parseUrl, creditsFor, forUser, submit, requestRecount, adminList, pendingCount, review };
