// Défi GTA VI de la semaine : un thème, l'utilisateur publie son clip et envoie le lien,
// un jury (l'admin) choisit les 3 meilleurs, qui gagnent des clips. Participation gratuite.
const crypto = require('crypto');
const { db, q, addCredits } = require('./db');
const { parseUrl } = require('./ugc');

db.exec(`
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  prizes TEXT NOT NULL DEFAULT '[30,15,5]',
  awarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS challenge_entries (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL,
  title TEXT,
  rank INTEGER,
  removed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ch_entry_url ON challenge_entries(challenge_id, url_key);
CREATE INDEX IF NOT EXISTS ch_entry_user ON challenge_entries(challenge_id, user_id);
`);

const MAX_ENTRIES = +process.env.CHALLENGE_MAX_ENTRIES || 2;
const err = (status, message) => Object.assign(new Error(message), { status });

// Premiers défis, prêts pour la sortie (modifiables depuis l'admin). Semaines du jeudi au mercredi.
if (!q.get('SELECT COUNT(*) AS n FROM challenges').n) {
  const seed = [
    ['Défi n°1', 'La poursuite la plus folle', 'Course-poursuite, fuite à toute vitesse, police aux trousses : montre ta meilleure poursuite.', '2026-11-19T00:00:00+01:00', '2026-11-25T23:59:59+01:00'],
    ['Défi n°2', 'Le crash le plus spectaculaire', 'Accident, cascade ratée, voiture qui s’envole : le crash qu’on veut revoir en boucle.', '2026-11-26T00:00:00+01:00', '2026-12-02T23:59:59+01:00'],
    ['Défi n°3', 'Le moment le plus drôle', 'Bug improbable, réaction culte, plan qui tourne mal : fais-nous rire.', '2026-12-03T00:00:00+01:00', '2026-12-09T23:59:59+01:00'],
    ['Défi n°4', 'Le braquage parfait', 'Préparation, action, fuite : ton meilleur coup du début à la fin.', '2026-12-10T00:00:00+01:00', '2026-12-16T23:59:59+01:00'],
  ];
  for (const [title, theme, desc, a, b] of seed) q.run('INSERT INTO challenges(id, title, theme, description, starts_at, ends_at) VALUES(?, ?, ?, ?, ?, ?)', crypto.randomBytes(6).toString('hex'), title, theme, desc, new Date(a).toISOString(), new Date(b).toISOString());
}

/** Lien accepté : TikTok, Reels Instagram, ou YouTube Shorts. */
function parseEntryUrl(raw) {
  const p = parseUrl(raw);
  if (p) return p;
  try {
    const u = new URL(String(raw || '').trim()), host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
    const m = host === 'youtube.com' && u.pathname.match(/^\/shorts\/([\w-]{6,20})\/?$/);
    if (m) return { platform: 'youtube', key: `youtube:${m[1]}`, url: `https://www.youtube.com/shorts/${m[1]}` };
  } catch { /* lien invalide */ }
  return null;
}

/** Nom affiché d'un participant : son @ TikTok si le lien en contient un, sinon le début de son e-mail. */
function publicName(url, email) {
  const m = String(url).match(/tiktok\.com\/(@[\w.-]+)/);
  if (m) return m[1];
  const local = String(email || '').split('@')[0];
  return local.slice(0, 3) + '•••';
}

const now = () => new Date().toISOString();
function statusOf(c) { const t = now(); return t < c.starts_at ? 'upcoming' : t > c.ends_at ? 'ended' : 'live'; }
const view = (c) => ({ id: c.id, title: c.title, theme: c.theme, description: c.description, startsAt: c.starts_at, endsAt: c.ends_at, prizes: JSON.parse(c.prizes), awarded: !!c.awarded, status: statusOf(c) });

function winners(cid) {
  return q.all('SELECT e.url, e.title, e.rank, u.email FROM challenge_entries e JOIN users u ON u.id = e.user_id WHERE e.challenge_id = ? AND e.rank IS NOT NULL AND e.removed = 0 ORDER BY e.rank', cid)
    .map((w) => ({ rank: w.rank, url: w.url, title: w.title, name: publicName(w.url, w.email) }));
}

function overview(userId) {
  const all = q.all('SELECT * FROM challenges ORDER BY starts_at');
  const t = now();
  const current = all.find((c) => c.starts_at <= t && t <= c.ends_at) || null;
  const next = all.find((c) => c.starts_at > t) || null;
  const past = all.filter((c) => c.ends_at < t).reverse().slice(0, 6);
  const mine = (cid) => (userId ? q.all('SELECT id, url, title, rank, created_at FROM challenge_entries WHERE challenge_id = ? AND user_id = ? AND removed = 0 ORDER BY created_at', cid, userId) : []);
  const count = (cid) => q.get('SELECT COUNT(*) AS n FROM challenge_entries WHERE challenge_id = ? AND removed = 0', cid).n;
  return {
    maxEntries: MAX_ENTRIES,
    current: current ? { ...view(current), entries: count(current.id), mine: mine(current.id) } : null,
    next: next ? view(next) : null,
    past: past.map((c) => ({ ...view(c), entries: count(c.id), winners: c.awarded ? winners(c.id) : [], mine: mine(c.id) })),
  };
}

function enter(userId, cid, { url, title, accept }) {
  const c = q.get('SELECT * FROM challenges WHERE id = ?', cid);
  if (!c) throw err(404, 'Défi introuvable.');
  if (statusOf(c) !== 'live') throw err(400, statusOf(c) === 'upcoming' ? 'Ce défi n’a pas encore commencé.' : 'Ce défi est terminé : rendez-vous au prochain !');
  if (!accept) throw err(400, 'Coche la case pour accepter le règlement du défi.');
  const p = parseEntryUrl(url);
  if (!p) throw err(400, 'Colle le lien de ton clip publié sur TikTok, Instagram (Reels) ou YouTube (Shorts).');
  const n = q.get('SELECT COUNT(*) AS n FROM challenge_entries WHERE challenge_id = ? AND user_id = ? AND removed = 0', cid, userId).n;
  if (n >= MAX_ENTRIES) throw err(400, `Tu as déjà envoyé ${MAX_ENTRIES} clips pour ce défi : c’est le maximum.`);
  if (q.get('SELECT id FROM challenge_entries WHERE challenge_id = ? AND url_key = ?', cid, p.key)) throw err(409, 'Ce clip participe déjà au défi.');
  const id = crypto.randomBytes(8).toString('hex');
  q.run('INSERT INTO challenge_entries(id, challenge_id, user_id, url, url_key, title) VALUES(?, ?, ?, ?, ?, ?)', id, cid, userId, p.url, p.key, String(title || '').trim().slice(0, 80) || null);
  return id;
}

// ---------- admin ----------
function adminList() {
  return q.all('SELECT * FROM challenges ORDER BY starts_at DESC').map((c) => ({ ...view(c), entries: q.get('SELECT COUNT(*) AS n FROM challenge_entries WHERE challenge_id = ? AND removed = 0', c.id).n }));
}
function adminEntries(cid) {
  return q.all('SELECT e.*, u.email FROM challenge_entries e JOIN users u ON u.id = e.user_id WHERE e.challenge_id = ? ORDER BY e.removed, e.rank IS NULL, e.rank, e.created_at', cid)
    .map((e) => ({ id: e.id, url: e.url, title: e.title, email: e.email, name: publicName(e.url, e.email), rank: e.rank, removed: !!e.removed, createdAt: e.created_at }));
}
function save(b, cid) {
  const title = String(b.title || '').trim().slice(0, 40), theme = String(b.theme || '').trim().slice(0, 80);
  const description = String(b.description || '').trim().slice(0, 300) || null;
  const a = new Date(b.startsAt), z = new Date(b.endsAt);
  if (!title || !theme) throw err(400, 'Donne un titre et un thème au défi.');
  if (isNaN(a) || isNaN(z) || z <= a) throw err(400, 'Dates invalides : la fin doit être après le début.');
  const prizes = (Array.isArray(b.prizes) ? b.prizes : [30, 15, 5]).slice(0, 3).map((x) => Math.max(0, Math.min(500, Math.trunc(+x || 0))));
  if (cid) {
    if (!q.get('SELECT id FROM challenges WHERE id = ?', cid)) throw err(404, 'Défi introuvable.');
    q.run('UPDATE challenges SET title = ?, theme = ?, description = ?, starts_at = ?, ends_at = ?, prizes = ? WHERE id = ?', title, theme, description, a.toISOString(), z.toISOString(), JSON.stringify(prizes), cid);
    return cid;
  }
  const id = crypto.randomBytes(6).toString('hex');
  q.run('INSERT INTO challenges(id, title, theme, description, starts_at, ends_at, prizes) VALUES(?, ?, ?, ?, ?, ?, ?)', id, title, theme, description, a.toISOString(), z.toISOString(), JSON.stringify(prizes));
  return id;
}
function remove(cid) { q.run('DELETE FROM challenges WHERE id = ?', cid); }
function setEntry(eid, { rank, removed }) {
  const e = q.get('SELECT e.*, c.awarded FROM challenge_entries e JOIN challenges c ON c.id = e.challenge_id WHERE e.id = ?', eid);
  if (!e) throw err(404, 'Participation introuvable.');
  if (e.awarded) throw err(400, 'Les prix de ce défi sont déjà attribués.');
  rank = [1, 2, 3].includes(+rank) ? +rank : null;
  if (rank) q.run('UPDATE challenge_entries SET rank = NULL WHERE challenge_id = ? AND rank = ?', e.challenge_id, rank);
  q.run('UPDATE challenge_entries SET rank = ?, removed = ? WHERE id = ?', removed ? null : rank, removed ? 1 : 0, eid);
}
/** Verse les prix aux gagnants (une seule fois), une fois le défi terminé. Renvoie la liste des gagnants payés. */
function award(cid, adminEmail) {
  const c = q.get('SELECT * FROM challenges WHERE id = ?', cid);
  if (!c) throw err(404, 'Défi introuvable.');
  if (c.awarded) throw err(400, 'Les prix sont déjà attribués.');
  if (statusOf(c) !== 'ended') throw err(400, 'Attends la fin du défi pour attribuer les prix.');
  const prizes = JSON.parse(c.prizes);
  const ws = q.all('SELECT * FROM challenge_entries WHERE challenge_id = ? AND rank IS NOT NULL AND removed = 0 ORDER BY rank', cid);
  if (!ws.length) throw err(400, 'Choisis au moins un gagnant.');
  q.run('UPDATE challenges SET awarded = 1 WHERE id = ?', cid);
  const paid = [];
  for (const w of ws) {
    const n = prizes[w.rank - 1] || 0;
    if (n) addCredits(w.user_id, n, `défi ${c.title} : ${w.rank}${w.rank === 1 ? 'er' : 'e'} (par ${adminEmail})`);
    paid.push({ userId: w.user_id, rank: w.rank, credits: n, challenge: c.title, theme: c.theme });
  }
  return paid;
}

module.exports = { overview, enter, adminList, adminEntries, save, remove, setEntry, award, statusOf };
