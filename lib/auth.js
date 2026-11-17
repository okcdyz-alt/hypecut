// Comptes : e-mail + mot de passe (scrypt), sessions par cookie HttpOnly.
const crypto = require('crypto');
const { q, addCredits } = require('./db');
const { signupCredits } = require('./plans');

const SESSION_DAYS = 30;
const COOKIE = 'hc_session';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const ref = Buffer.from(hashHex, 'hex');
  return ref.length === hash.length && crypto.timingSafeEqual(ref, hash);
}

function validEmail(e) { return typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

function signup(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!validEmail(email)) throw httpError(400, 'Adresse e-mail invalide.');
  if (typeof password !== 'string' || password.length < 8) throw httpError(400, 'Le mot de passe doit faire au moins 8 caractères.');
  if (password.length > 200) throw httpError(400, 'Mot de passe trop long.');
  if (q.get('SELECT id FROM users WHERE email = ?', email)) throw httpError(409, 'Un compte existe déjà avec cette adresse.');
  const id = crypto.randomUUID();
  q.run('INSERT INTO users(id, email, pass_hash, plan, credits) VALUES(?, ?, ?, ?, 0)', id, email, hashPassword(password), 'free');
  addCredits(id, signupCredits(), 'signup');
  const admins = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (admins.includes(email)) { q.run("UPDATE users SET plan = 'creator' WHERE id = ?", id); addCredits(id, 1000, 'admin'); }
  return id;
}

function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  const u = q.get('SELECT * FROM users WHERE email = ?', email);
  if (!u || !checkPassword(String(password || ''), u.pass_hash)) throw httpError(401, 'E-mail ou mot de passe incorrect.');
  return u.id;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.run('INSERT INTO sessions(token, user_id, expires) VALUES(?, ?, ?)', token, userId, Date.now() + SESSION_DAYS * 86400e3);
  return token;
}

function destroySession(token) { if (token) q.run('DELETE FROM sessions WHERE token = ?', token); }

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = q.get('SELECT * FROM sessions WHERE token = ?', token);
  if (!s) return null;
  if (s.expires < Date.now()) { destroySession(token); return null; }
  return q.get('SELECT * FROM users WHERE id = ?', s.user_id) || null;
}

function sessionCookie(token, secure) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? SESSION_DAYS * 86400 : 0}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

// Limiteur simple en mémoire (par clé, fenêtre glissante)
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr);
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600e3)) buckets.delete(k); }, 600e3).unref();

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { signup, login, createSession, destroySession, currentUser, sessionCookie, parseCookies, rateLimit, httpError, COOKIE };
