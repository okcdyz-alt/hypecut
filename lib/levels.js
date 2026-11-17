// Niveaux de clippeur : selon le nombre de clips exportés. Chaque nouveau niveau donne des clips
// offerts (une seule fois) et, à partir d'Or, une place prioritaire dans la file d'attente.
const { db, q, addCredits } = require('./db');

try { db.exec('ALTER TABLE users ADD COLUMN level_rewarded INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà là */ }

const LEVELS = [
  { id: 0, key: 'bronze', name: 'Bronze', emoji: '🥉', min: 0, bonus: 0, priority: 0, perks: ['Accès à tous les défis GTA VI'] },
  { id: 1, key: 'silver', name: 'Argent', emoji: '🥈', min: 10, bonus: 5, priority: 0, perks: ['5 clips offerts', 'Badge Argent'] },
  { id: 2, key: 'gold', name: 'Or', emoji: '🥇', min: 50, bonus: 15, priority: 0.25, perks: ['15 clips offerts', 'File d’attente prioritaire', 'Badge Or'] },
  { id: 3, key: 'diamond', name: 'Diamant', emoji: '💎', min: 150, bonus: 30, priority: 0.4, perks: ['30 clips offerts', 'File d’attente prioritaire', 'Badge Diamant'] },
];

const clipCount = (userId) => q.get("SELECT COUNT(*) AS n FROM exports WHERE user_id = ? AND status = 'done'", userId).n;
const levelFor = (n) => [...LEVELS].reverse().find((l) => n >= l.min);

function forUser(userId) {
  const n = clipCount(userId), lvl = levelFor(n), next = LEVELS[lvl.id + 1] || null;
  const pct = next ? Math.round(((n - lvl.min) / (next.min - lvl.min)) * 100) : 100;
  return { clips: n, level: lvl, next, toNext: next ? next.min - n : 0, pct, levels: LEVELS };
}

/** Bonus de file d'attente (s'ajoute à celui de l'offre, sans dépasser l'offre supérieure). */
function priorityBonus(userId) { return levelFor(clipCount(userId)).priority; }

/** Après un export réussi : verse les bonus des niveaux atteints et pas encore récompensés. Renvoie le nouveau niveau, ou null. */
function checkLevelUp(userId) {
  const u = q.get('SELECT level_rewarded FROM users WHERE id = ?', userId);
  if (!u) return null;
  const lvl = levelFor(clipCount(userId));
  if (lvl.id <= u.level_rewarded) return null;
  q.run('UPDATE users SET level_rewarded = ? WHERE id = ?', lvl.id, userId);
  for (const l of LEVELS) if (l.id > u.level_rewarded && l.id <= lvl.id && l.bonus) addCredits(userId, l.bonus, `niveau ${l.name}`);
  return lvl;
}

module.exports = { LEVELS, forUser, levelFor, clipCount, priorityBonus, checkLevelUp };
