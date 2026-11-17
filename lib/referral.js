// Parrainage : 5 clips offerts au parrain et au filleul quand le filleul exporte son premier clip.
const crypto = require('crypto');
const { q, addCredits } = require('./db');

const REWARD = +process.env.REFERRAL_CREDITS || 5;
const MAX_PER_MONTH = +process.env.REFERRAL_MAX_PER_MONTH || 50;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (let i = 0; i < 20; i++) {
    const bytes = crypto.randomBytes(6);
    const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    if (!q.get('SELECT id FROM users WHERE ref_code = ?', code)) return code;
  }
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function codeFor(userId) {
  const u = q.get('SELECT ref_code FROM users WHERE id = ?', userId);
  if (u?.ref_code) return u.ref_code;
  const code = newCode();
  q.run('UPDATE users SET ref_code = ? WHERE id = ?', code, userId);
  return code;
}

/** À l'inscription : rattache le filleul à son parrain (si le code est valide et pas d'auto-parrainage évident). */
function attach(newUserId, code, ip) {
  if (ip) q.run('UPDATE users SET signup_ip = ? WHERE id = ?', ip, newUserId);
  code = String(code || '').trim().toUpperCase().slice(0, 16);
  if (!code) return;
  const parrain = q.get('SELECT id, signup_ip FROM users WHERE ref_code = ?', code);
  if (!parrain || parrain.id === newUserId) return;
  if (ip && parrain.signup_ip && parrain.signup_ip === ip) return; // même connexion : on ne récompense pas
  q.run('UPDATE users SET referred_by = ? WHERE id = ?', parrain.id, newUserId);
}

/** Au premier export réussi du filleul : récompense les deux, une seule fois. */
function rewardIfFirstExport(userId) {
  const u = q.get('SELECT id, referred_by, ref_rewarded FROM users WHERE id = ?', userId);
  if (!u || !u.referred_by || u.ref_rewarded) return;
  const done = q.get("SELECT COUNT(*) AS n FROM exports WHERE user_id = ? AND status = 'done'", userId).n;
  if (done < 1) return;
  const month = q.get(`SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND reason LIKE 'parrainage : filleul%' AND created_at > datetime('now', '-30 days')`, u.referred_by).n;
  q.run('UPDATE users SET ref_rewarded = 1 WHERE id = ?', u.id);
  addCredits(u.id, REWARD, 'parrainage : bienvenue');
  if (month < MAX_PER_MONTH) addCredits(u.referred_by, REWARD, `parrainage : filleul ${u.id}`);
}

function stats(userId) {
  const invited = q.get('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?', userId).n;
  const validated = q.get('SELECT COUNT(*) AS n FROM users WHERE referred_by = ? AND ref_rewarded = 1', userId).n;
  const earned = q.get("SELECT COALESCE(SUM(delta), 0) AS n FROM ledger WHERE user_id = ? AND reason LIKE 'parrainage : filleul%'", userId).n;
  return { code: codeFor(userId), invited, validated, earned, reward: REWARD };
}

module.exports = { codeFor, attach, rewardIfFirstExport, stats, REWARD };
