// Base de données SQLite intégrée à Node (aucune dépendance). Fichier dans DATA_DIR.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'hypecut.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  credits INTEGER NOT NULL DEFAULT 0,
  period_end TEXT,
  stripe_customer TEXT,
  stripe_sub TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT,
  source_type TEXT,
  source_url TEXT,
  title TEXT,
  options TEXT,
  meta TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_idx INTEGER NOT NULL,
  options TEXT,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS exports_job ON exports(job_id);
`);

const q = {
  get: (sql, ...a) => db.prepare(sql).get(...a),
  all: (sql, ...a) => db.prepare(sql).all(...a),
  run: (sql, ...a) => db.prepare(sql).run(...a),
};

function setting(key, value) {
  if (value === undefined) return q.get('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
  q.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
  return value;
}

/** Ajoute (ou retire) des crédits et garde une trace. Renvoie false si solde insuffisant. */
function addCredits(userId, delta, reason) {
  if (delta < 0) {
    const r = q.run('UPDATE users SET credits = credits + ? WHERE id = ? AND credits + ? >= 0', delta, userId, delta);
    if (!r.changes) return false;
  } else {
    q.run('UPDATE users SET credits = credits + ? WHERE id = ?', delta, userId);
  }
  q.run('INSERT INTO ledger(user_id, delta, reason) VALUES(?, ?, ?)', userId, delta, reason || null);
  return true;
}

function setCredits(userId, value, reason) {
  q.run('UPDATE users SET credits = ? WHERE id = ?', value, userId);
  q.run('INSERT INTO ledger(user_id, delta, reason) VALUES(?, ?, ?)', userId, 0, `${reason || 'reset'} => ${value}`);
}

module.exports = { db, q, setting, addCredits, setCredits, DATA_DIR };
