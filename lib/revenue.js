// Tableau de bord des revenus du clippeur : l'utilisateur note ses campagnes et ses clips publiés
// (vues, montant, payé ou non). HYPECUT ne connaît pas ses revenus réels : tout est saisi par lui.
const crypto = require('crypto');
const { db, q } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS rev_campaigns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT,
  rate REAL NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rev_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES rev_campaigns(id) ON DELETE SET NULL,
  url TEXT,
  title TEXT,
  posted_on TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  amount REAL,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS rev_posts_user ON rev_posts(user_id, posted_on);
CREATE INDEX IF NOT EXISTS rev_campaigns_user ON rev_campaigns(user_id);
`);
try { db.exec("ALTER TABLE users ADD COLUMN rev_currency TEXT NOT NULL DEFAULT '$'"); } catch { /* déjà là */ }

const err = (status, message) => Object.assign(new Error(message), { status });
const id = () => crypto.randomBytes(8).toString('hex');
const PLATFORMS = ['Content Rewards', 'Whop', 'Accord direct avec le streamer', 'Programme créateur TikTok', 'Autre'];
const CURRENCIES = ['$', '€'];
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const money = (v) => { if (v === '' || v === null || v === undefined) return null; const n = +String(v).replace(',', '.'); if (!Number.isFinite(n) || n < 0 || n > 1e7) throw err(400, 'Montant invalide.'); return Math.round(n * 100) / 100; };
const int = (v) => { const n = Math.trunc(+String(v ?? 0).replace(/[\s .,]/g, '')); if (!Number.isFinite(n) || n < 0 || n > 1e10) throw err(400, 'Nombre de vues invalide.'); return n; };
const day = (v) => { const s = text(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw err(400, 'Date invalide.'); return s; };
const safeUrl = (v) => { const s = text(v, 400); if (!s) return null; try { const u = new URL(s); if (!/^https?:$/.test(u.protocol)) throw 0; return u.href; } catch { throw err(400, 'Lien invalide : colle l’adresse complète de ta vidéo.'); } };

function ownCampaign(userId, cid) {
  if (!cid) return null;
  const c = q.get('SELECT id FROM rev_campaigns WHERE id = ? AND user_id = ?', cid, userId);
  if (!c) throw err(404, 'Campagne introuvable.');
  return c.id;
}

/** Montant d'un clip : celui saisi, sinon l'estimation vues × tarif de la campagne. */
const amountOf = (p) => (p.amount !== null && p.amount !== undefined ? p.amount : (p.views / 1000) * (p.rate || 0));

function weekStart(d) { const x = new Date(d + 'T12:00:00Z'); const wd = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - wd); return x.toISOString().slice(0, 10); }

function dashboard(userId) {
  const currency = q.get('SELECT rev_currency FROM users WHERE id = ?', userId)?.rev_currency || '$';
  const campaigns = q.all('SELECT * FROM rev_campaigns WHERE user_id = ? ORDER BY archived, created_at DESC', userId);
  const posts = q.all(`SELECT p.*, c.rate, c.name AS campaign FROM rev_posts p LEFT JOIN rev_campaigns c ON c.id = p.campaign_id
    WHERE p.user_id = ? ORDER BY p.posted_on DESC, p.created_at DESC LIMIT 500`, userId);
  const r2 = (n) => Math.round(n * 100) / 100;
  const month = new Date().toISOString().slice(0, 7);
  let total = 0, received = 0, views = 0, monthTotal = 0, monthViews = 0;
  for (const p of posts) {
    const a = amountOf(p); p.value = r2(a); p.estimated = p.amount === null;
    total += a; views += p.views; if (p.paid) received += a;
    if (p.posted_on.startsWith(month)) { monthTotal += a; monthViews += p.views; }
  }
  // 8 dernières semaines (lundi → dimanche)
  const weeks = [];
  const thisWeek = weekStart(new Date().toISOString().slice(0, 10));
  for (let i = 7; i >= 0; i--) { const d = new Date(thisWeek + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - i * 7); weeks.push({ day: d.toISOString().slice(0, 10), n: 0 }); }
  const idx = Object.fromEntries(weeks.map((w, i) => [w.day, i]));
  for (const p of posts) { const i = idx[weekStart(p.posted_on)]; if (i !== undefined) weeks[i].n = r2(weeks[i].n + amountOf(p)); }
  const perCampaign = campaigns.map((c) => {
    const ps = posts.filter((p) => p.campaign_id === c.id);
    return { id: c.id, name: c.name, platform: c.platform, rate: c.rate, archived: !!c.archived, clips: ps.length, views: ps.reduce((s, p) => s + p.views, 0), total: r2(ps.reduce((s, p) => s + amountOf(p), 0)) };
  });
  return {
    currency, currencies: CURRENCIES, platforms: PLATFORMS,
    summary: { total: r2(total), received: r2(received), pending: r2(total - received), views, rpm: views ? r2((total / views) * 1000) : 0, clips: posts.length, monthTotal: r2(monthTotal), monthViews },
    weeks, campaigns: perCampaign,
    posts: posts.map((p) => ({ id: p.id, campaignId: p.campaign_id, campaign: p.campaign, url: p.url, title: p.title, postedOn: p.posted_on, views: p.views, amount: p.amount, value: p.value, estimated: p.estimated, paid: !!p.paid })),
  };
}

function setCurrency(userId, c) { if (!CURRENCIES.includes(c)) throw err(400, 'Devise inconnue.'); q.run('UPDATE users SET rev_currency = ? WHERE id = ?', c, userId); }

function saveCampaign(userId, b, cid) {
  const name = text(b.name, 60);
  if (!name) throw err(400, 'Donne un nom à ta campagne.');
  const platform = PLATFORMS.includes(b.platform) ? b.platform : 'Autre';
  const rate = money(b.rate) ?? 0;
  if (rate > 1000) throw err(400, 'Tarif pour 1 000 vues trop élevé.');
  if (cid) {
    ownCampaign(userId, cid);
    q.run('UPDATE rev_campaigns SET name = ?, platform = ?, rate = ?, archived = ? WHERE id = ?', name, platform, rate, b.archived ? 1 : 0, cid);
    return cid;
  }
  if (q.get('SELECT COUNT(*) AS n FROM rev_campaigns WHERE user_id = ?', userId).n >= 100) throw err(400, 'Tu as atteint 100 campagnes : archive ou supprime les anciennes.');
  const newId = id();
  q.run('INSERT INTO rev_campaigns(id, user_id, name, platform, rate) VALUES(?, ?, ?, ?, ?)', newId, userId, name, platform, rate);
  return newId;
}
function deleteCampaign(userId, cid) { ownCampaign(userId, cid); q.run('DELETE FROM rev_campaigns WHERE id = ?', cid); }

function savePost(userId, b, pid) {
  const row = {
    campaign_id: ownCampaign(userId, b.campaignId || null),
    url: safeUrl(b.url), title: text(b.title, 120) || null,
    posted_on: day(b.postedOn || new Date().toISOString().slice(0, 10)),
    views: int(b.views), amount: money(b.amount), paid: b.paid ? 1 : 0,
  };
  if (pid) {
    if (!q.get('SELECT id FROM rev_posts WHERE id = ? AND user_id = ?', pid, userId)) throw err(404, 'Clip introuvable.');
    q.run('UPDATE rev_posts SET campaign_id = ?, url = ?, title = ?, posted_on = ?, views = ?, amount = ?, paid = ? WHERE id = ?', row.campaign_id, row.url, row.title, row.posted_on, row.views, row.amount, row.paid, pid);
    return pid;
  }
  if (q.get('SELECT COUNT(*) AS n FROM rev_posts WHERE user_id = ?', userId).n >= 2000) throw err(400, 'Limite de 2 000 clips atteinte.');
  const newId = id();
  q.run('INSERT INTO rev_posts(id, user_id, campaign_id, url, title, posted_on, views, amount, paid) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)', newId, userId, row.campaign_id, row.url, row.title, row.posted_on, row.views, row.amount, row.paid);
  return newId;
}
function deletePost(userId, pid) {
  const r = q.run('DELETE FROM rev_posts WHERE id = ? AND user_id = ?', pid, userId);
  if (!r.changes) throw err(404, 'Clip introuvable.');
}

module.exports = { dashboard, setCurrency, saveCampaign, deleteCampaign, savePost, deletePost };
