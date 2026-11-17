// Tableau de bord admin : chiffres, santé du serveur, gestion des comptes.
const fs = require('fs');
const { q, addCredits, DATA_DIR } = require('./db');
const { PLANS } = require('./plans');

const admins = () => String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const isAdmin = (u) => !!u && admins().includes(String(u.email).toLowerCase());

function days(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400e3); out.push(d.toISOString().slice(0, 10)); }
  return out;
}
function perDay(sql, n) {
  const rows = q.all(sql, `-${n} days`);
  const map = Object.fromEntries(rows.map((r) => [r.d, r.n]));
  return days(n).map((d) => ({ day: d, n: map[d] || 0 }));
}

function dirSize(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) total += dirSize(p); else { try { total += fs.statSync(p).size; } catch {} }
    }
  } catch {}
  return total;
}

function stats(queueState) {
  const n = (sql, ...a) => q.get(sql, ...a).n;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const ms = monthStart.toISOString().replace('T', ' ').slice(0, 19);
  const pro = n("SELECT COUNT(*) AS n FROM users WHERE plan = 'pro' AND stripe_sub IS NOT NULL");
  const creator = n("SELECT COUNT(*) AS n FROM users WHERE plan = 'creator' AND stripe_sub IS NOT NULL");
  const packsMonth = n("SELECT COUNT(*) AS n FROM ledger WHERE reason = 'pack20' AND created_at >= ?", ms);
  const packsAll = n("SELECT COUNT(*) AS n FROM ledger WHERE reason = 'pack20'");
  let disk = null;
  try { const st = fs.statfsSync(DATA_DIR); disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch {}
  return {
    users: {
      total: n('SELECT COUNT(*) AS n FROM users'),
      today: n("SELECT COUNT(*) AS n FROM users WHERE created_at >= date('now')"),
      week: n("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-7 days')"),
      referred: n('SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL'),
      ugcPending: n("SELECT COUNT(*) AS n FROM ugc_submissions WHERE status = 'pending'"),
      perDay: perDay("SELECT date(created_at) AS d, COUNT(*) AS n FROM users WHERE created_at >= datetime('now', ?) GROUP BY d", 14),
    },
    activity: {
      jobs: n('SELECT COUNT(*) AS n FROM jobs'),
      clips: n("SELECT COUNT(*) AS n FROM exports WHERE status = 'done'"),
      clipsWeek: n("SELECT COUNT(*) AS n FROM exports WHERE status = 'done' AND created_at >= datetime('now', '-7 days')"),
      clipsPerDay: perDay("SELECT date(created_at) AS d, COUNT(*) AS n FROM exports WHERE status = 'done' AND created_at >= datetime('now', ?) GROUP BY d", 14),
      topLayouts: q.all("SELECT json_extract(options, '$.layout') AS layout, COUNT(*) AS n FROM exports WHERE status = 'done' GROUP BY layout ORDER BY n DESC LIMIT 5"),
    },
    money: {
      pro, creator, packsMonth, packsAll,
      mrr: Math.round(pro * PLANS.pro.price + creator * PLANS.creator.price),
      packsRevenueMonth: packsMonth * 299,
    },
    health: {
      queue: queueState(),
      failed24h: n("SELECT COUNT(*) AS n FROM exports WHERE status = 'error' AND created_at >= datetime('now', '-1 day')"),
      jobsFailed24h: n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'error' AND created_at >= datetime('now', '-1 day')"),
      lastErrors: q.all("SELECT created_at, message FROM exports WHERE status = 'error' ORDER BY created_at DESC LIMIT 5"),
      lastJobErrors: q.all("SELECT j.created_at, j.message, j.source_type, j.source_url, u.email FROM jobs j LEFT JOIN users u ON u.id = j.user_id WHERE j.status = 'error' ORDER BY j.created_at DESC LIMIT 10")
        .map((j) => ({ at: j.created_at, reason: String(j.message || '').split('\n')[0], source: j.source_type === 'upload' ? 'Fichier importé' : j.source_url, email: j.email })),
      mediaBytes: dirSize(`${DATA_DIR}/media`),
      disk,
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      uptimeH: +(process.uptime() / 3600).toFixed(1),
    },
  };
}

function searchUsers(term) {
  const like = `%${String(term || '').trim().toLowerCase()}%`;
  return q.all(`SELECT u.id, u.email, u.plan, u.credits, u.created_at, u.stripe_sub IS NOT NULL AS subscribed,
    (SELECT COUNT(*) FROM exports e WHERE e.user_id = u.id AND e.status = 'done') AS clips
    FROM users u WHERE lower(u.email) LIKE ? ORDER BY u.created_at DESC LIMIT 30`, like);
}

function updateUser(id, { credits, plan }, adminEmail) {
  const u = q.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw Object.assign(new Error('Compte introuvable.'), { status: 404 });
  const delta = Math.trunc(+credits || 0);
  if (delta) {
    if (Math.abs(delta) > 10000) throw Object.assign(new Error('Montant trop grand.'), { status: 400 });
    if (!addCredits(id, delta, `admin ${adminEmail}`)) throw Object.assign(new Error('Solde insuffisant pour retirer autant.'), { status: 400 });
  }
  if (plan && plan !== u.plan) {
    if (!PLANS[plan]) throw Object.assign(new Error('Offre inconnue.'), { status: 400 });
    q.run('UPDATE users SET plan = ? WHERE id = ?', plan, id);
    q.run('INSERT INTO ledger(user_id, delta, reason) VALUES(?, 0, ?)', id, `admin ${adminEmail} : offre ${u.plan} → ${plan}`);
  }
  return q.get('SELECT id, email, plan, credits FROM users WHERE id = ?', id);
}

module.exports = { isAdmin, stats, searchUsers, updateUser };
