// E-mails automatiques via Brevo (API HTTP, aucune dépendance).
// Variables Render : BREVO_API_KEY, MAIL_FROM (adresse d'envoi vérifiée dans Brevo), MAIL_FROM_NAME, MAIL_DAILY_LIMIT.
// Sans clé, rien n'est envoyé (le site fonctionne normalement).
const crypto = require('crypto');
const { db, q, setting } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS email_once ON email_log(user_id, kind, ref);
CREATE INDEX IF NOT EXISTS email_sent ON email_log(sent_at);
`);
try { db.exec('ALTER TABLE users ADD COLUMN email_opt_out INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà là */ }

const PUBLIC_URL = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '');
const enabled = () => !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
const DAILY = () => +process.env.MAIL_DAILY_LIMIT || 250; // offre gratuite Brevo : 300 e-mails par jour
// Conseils et annonces : on respecte la désinscription. Les autres (compte, gains) partent toujours.
const MARKETING = new Set(['nudge_first_clip', 'credits_empty', 'inactive', 'challenge_new']);

function secret() {
  let s = process.env.MAIL_SECRET || setting('mail_secret');
  if (!s) s = setting('mail_secret', crypto.randomBytes(24).toString('hex'));
  return s;
}
const token = (userId) => crypto.createHmac('sha256', secret()).update(String(userId)).digest('hex').slice(0, 32);
const unsubUrl = (userId) => `${PUBLIC_URL()}/unsubscribe?u=${encodeURIComponent(userId)}&t=${token(userId)}`;
function unsubscribe(userId, t) {
  if (!userId || !t || t.length !== 32) return false;
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(String(t)), Buffer.from(token(userId))); } catch { ok = false; }
  if (ok) q.run('UPDATE users SET email_opt_out = 1 WHERE id = ?', userId);
  return ok;
}
function setOptOut(userId, optOut) { q.run('UPDATE users SET email_opt_out = ? WHERE id = ?', optOut ? 1 : 0, userId); }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sentToday = () => q.get("SELECT COUNT(*) AS n FROM email_log WHERE sent_at > datetime('now', '-1 day')").n;

/** Mise en page commune : en-tête dégradé, texte, bouton, pied avec désinscription. */
function layout({ title, paras, cta, ctaUrl, userId, marketing }) {
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f0fa;font-family:Arial,Helvetica,sans-serif;color:#1d1530">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#160a1e;background-image:linear-gradient(90deg,#ffad3d,#ff3d8b 55%,#8b5cf6);padding:18px 24px;color:#ffffff;font-size:22px;font-weight:900;letter-spacing:.5px">HYPECUT</td></tr>
<tr><td style="padding:26px 24px 8px"><h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${esc(title)}</h1>
${paras.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${p}</p>`).join('')}
${cta ? `<p style="margin:20px 0 10px"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#ff3d8b;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">${esc(cta)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px 22px;font-size:12px;line-height:1.5;color:#7a6f92">Tu reçois cet e-mail car tu as un compte HYPECUT.${marketing ? ` <a href="${esc(unsubUrl(userId))}" style="color:#7a6f92">Ne plus recevoir les conseils et annonces</a>.` : ''}<br>HYPECUT n’est ni affilié ni approuvé par Rockstar Games ou Take-Two Interactive.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title}\n\n${paras.map((p) => p.replace(/<[^>]+>/g, '')).join('\n\n')}${cta ? `\n\n${cta} : ${ctaUrl}` : ''}\n\n—\nHYPECUT${marketing ? `\nNe plus recevoir les conseils et annonces : ${unsubUrl(userId)}` : ''}`;
  return { html, text };
}

// ---------- contenus ----------
const T = {
  welcome: (d) => ({ subject: 'Bienvenue sur HYPECUT 🎮 tes clips t’attendent', title: 'Bienvenue sur HYPECUT !',
    paras: [`Ton compte est prêt, avec <b>${d.credits} clips offerts</b>.`, '1. Colle le lien de ta VOD Twitch ou Kick, ou importe ta vidéo.<br>2. HYPECUT repère les meilleurs moments.<br>3. Choisis ton format (écran partagé satisfaisant, caméra en haut…) et exporte.', 'Tu peux aussi suivre tes revenus de clippeur et participer au défi GTA VI de la semaine.'],
    cta: 'Créer mon premier clip', path: '/#creer' }),
  nudge_first_clip: () => ({ subject: 'Ton premier clip GTA VI en 1 minute ⚡', title: 'Ton premier clip t’attend',
    paras: ['Tu as créé ton compte mais pas encore ton premier clip. Ça prend une minute : colle le lien de ta VOD ou importe ta vidéo, HYPECUT trouve les meilleurs moments à ta place.', 'Astuce : le format « écran partagé satisfaisant » garde les gens jusqu’à la fin du clip.'],
    cta: 'Créer mon premier clip', path: '/#creer' }),
  credits_empty: () => ({ subject: 'Plus de crédits ? Voici comment en récupérer', title: 'Tu n’as plus de crédits',
    paras: ['Pour continuer à clipper :', '• <b>Passe à Pro</b> : 100 clips par mois, sans filigrane.<br>• <b>Gagne des clips gratuitement</b> : publie une vidéo qui présente HYPECUT et gagne des clips selon ses vues (programme créateur, dans « Mon compte »).<br>• <b>Parraine tes amis</b> : des clips pour toi et pour eux.<br>• <b>Gagne le défi GTA VI de la semaine</b>.'],
    cta: 'Voir les offres', path: '/#offres' }),
  inactive: (d) => (d.challenge
    ? { subject: `Défi GTA VI : ${d.challenge.theme} 🏆`, title: `Le défi de la semaine : ${d.challenge.theme}`, paras: ['Ça fait un moment ! Cette semaine, les 3 meilleurs clips sur ce thème gagnent des clips HYPECUT. Participation gratuite.'], cta: 'Voir le défi', path: '/#defi' }
    : { subject: 'Tes meilleurs moments t’attendent 🎮', title: 'Ça fait un moment !', paras: ['Tes dernières sessions cachent sûrement des moments à clipper. Colle le lien de ta VOD : HYPECUT les trouve pour toi.'], cta: 'Créer un clip', path: '/#creer' }),
  challenge_new: (d) => ({ subject: `Nouveau défi GTA VI : ${d.theme} 🏆`, title: `Nouveau défi : ${d.theme}`,
    paras: [esc(d.description || 'Publie ton meilleur clip sur ce thème et envoie le lien.'), `Prix : <b>${d.prizes[0]} clips</b> pour le 1er, ${d.prizes[1]} pour le 2e, ${d.prizes[2]} pour le 3e. Participation gratuite, jusqu’au ${new Date(d.endsAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })}.`],
    cta: 'Je participe', path: '/#defi' }),
  level_up: (d) => ({ subject: `Niveau ${d.level.name} ${d.level.emoji} débloqué !`, title: `Bravo, tu passes ${d.level.name} ${d.level.emoji}`,
    paras: [`Tu as créé ${d.level.min} clips.${d.level.bonus ? ` Pour fêter ça, <b>${d.level.bonus} clips</b> viennent d’être ajoutés à ton compte.` : ''}`, `Tes avantages : ${d.level.perks.map(esc).join(', ')}.`],
    cta: 'Voir mon niveau', path: '/#compte' }),
  ugc_approved: (d) => ({ subject: `+${d.granted} clips pour ta vidéo 🎉`, title: 'Ta vidéo a été validée',
    paras: [`Ta vidéo a été vérifiée avec <b>${Number(d.views).toLocaleString('fr-FR')} vues</b> : <b>${d.granted} clips</b> ont été ajoutés à ton compte.`, 'Si elle continue de faire des vues, tu pourras demander un nouveau comptage dans quelques jours, depuis « Mon compte ».'],
    cta: 'Voir mon compte', path: '/#compte' }),
  challenge_win: (d) => ({ subject: `Tu as gagné le défi « ${d.theme} » 🏆`, title: `${d.rank === 1 ? '🥇' : d.rank === 2 ? '🥈' : '🥉'} Tu es ${d.rank}${d.rank === 1 ? 'er' : 'e'} du défi !`,
    paras: [`Ton clip fait partie des meilleurs du ${esc(d.challenge)} « ${esc(d.theme)} ». <b>${d.credits} clips</b> ont été ajoutés à ton compte.`, 'Ton pseudo et le lien de ton clip sont affichés sur la page du défi. Rendez-vous au prochain !'],
    cta: 'Voir les résultats', path: '/#defi' }),
};

async function deliver(user, kind, data) {
  const t = T[kind](data || {});
  const marketing = MARKETING.has(kind);
  const { html, text } = layout({ title: t.title, paras: t.paras, cta: t.cta, ctaUrl: PUBLIC_URL() + t.path, userId: user.id, marketing });
  const headers = marketing ? { 'List-Unsubscribe': `<${unsubUrl(user.id)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
  const r = await fetch(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: process.env.MAIL_FROM_NAME || 'HYPECUT', email: process.env.MAIL_FROM }, to: [{ email: user.email }], subject: t.subject, htmlContent: html, textContent: text, headers, tags: [kind] }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status} : ${(await r.text()).slice(0, 200)}`);
}

/** Envoie un e-mail une seule fois par (compte, type, référence). Ne lève jamais d'erreur. */
async function sendOnce(userId, kind, ref, data, { force = false } = {}) {
  try {
    if (!enabled() || !T[kind]) return false;
    const user = q.get('SELECT id, email, email_opt_out FROM users WHERE id = ?', userId);
    if (!user) return false;
    if (MARKETING.has(kind) && user.email_opt_out) return false;
    if (!force && sentToday() >= DAILY()) return false;
    const claim = q.run('INSERT OR IGNORE INTO email_log(user_id, kind, ref) VALUES(?, ?, ?)', userId, kind, String(ref || ''));
    if (!claim.changes) return false; // déjà envoyé
    try { await deliver(user, kind, data); return true; }
    catch (e) { q.run('DELETE FROM email_log WHERE user_id = ? AND kind = ? AND ref = ?', userId, kind, String(ref || '')); console.warn('[mail]', kind, e.message); return false; }
  } catch (e) { console.warn('[mail]', e.message); return false; }
}

/** E-mail déclenché par un événement (inscription, niveau, gain…). */
function event(userId, kind, ref, data) { sendOnce(userId, kind, ref, data, { force: !MARKETING.has(kind) }); }

// ---------- tournée automatique (toutes les 30 min) ----------
let sweeping = false;
async function sweep() {
  if (!enabled() || sweeping) return;
  sweeping = true;
  try {
    const room = () => DAILY() - sentToday();
    const run = async (rows, kind, ref, data) => { for (const r of rows) { if (room() <= 0) return; await sendOnce(r.id, kind, typeof ref === 'function' ? ref(r) : ref, data); await new Promise((ok) => setTimeout(ok, 250)); } };
    const month = new Date().toISOString().slice(0, 7);
    const hasClip = "EXISTS (SELECT 1 FROM exports e WHERE e.user_id = u.id AND e.status = 'done')";
    const optIn = 'u.email_opt_out = 0';
    // 1. Pas encore de clip 24 h après l'inscription
    await run(q.all(`SELECT u.id FROM users u WHERE ${optIn} AND NOT ${hasClip} AND u.created_at < datetime('now', '-1 day') AND u.created_at > datetime('now', '-7 days')
      AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.user_id = u.id AND l.kind = 'nudge_first_clip') LIMIT 100`), 'nudge_first_clip', '');
    // 2. Crédits épuisés récemment (au plus une fois par mois)
    await run(q.all(`SELECT u.id FROM users u WHERE ${optIn} AND u.credits <= 0 AND ${hasClip}
      AND EXISTS (SELECT 1 FROM ledger g WHERE g.user_id = u.id AND g.delta < 0 AND g.created_at > datetime('now', '-3 days'))
      AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.user_id = u.id AND l.kind = 'credits_empty' AND l.sent_at > datetime('now', '-30 days')) LIMIT 100`), 'credits_empty', month);
    // 3. Nouveau défi (les 2 premiers jours)
    const ch = q.get("SELECT * FROM challenges WHERE starts_at <= ? AND ends_at >= ? AND starts_at >= ? ORDER BY starts_at DESC LIMIT 1", new Date().toISOString(), new Date().toISOString(), new Date(Date.now() - 2 * 86400e3).toISOString());
    if (ch) {
      const d = { theme: ch.theme, description: ch.description, prizes: JSON.parse(ch.prizes), endsAt: ch.ends_at };
      await run(q.all(`SELECT u.id FROM users u WHERE ${optIn} AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.user_id = u.id AND l.kind = 'challenge_new' AND l.ref = ?)
        ORDER BY ${hasClip} DESC, u.created_at DESC LIMIT 200`, ch.id), 'challenge_new', ch.id, d);
    }
    // 4. Inactif depuis 14 jours (au plus une fois par mois)
    const live = q.get('SELECT theme FROM challenges WHERE starts_at <= ? AND ends_at >= ? LIMIT 1', new Date().toISOString(), new Date().toISOString());
    await run(q.all(`SELECT u.id FROM users u WHERE ${optIn} AND ${hasClip} AND u.created_at < datetime('now', '-14 days')
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.user_id = u.id AND j.created_at > datetime('now', '-14 days'))
      AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.user_id = u.id AND l.kind IN ('inactive', 'challenge_new') AND l.sent_at > datetime('now', '-14 days'))
      AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.user_id = u.id AND l.kind = 'inactive' AND l.sent_at > datetime('now', '-30 days')) LIMIT 100`), 'inactive', month, { challenge: live });
  } catch (e) { console.warn('[mail] tournée', e.message); }
  finally { sweeping = false; }
}
function start() {
  setTimeout(sweep, 60e3);
  setInterval(sweep, 30 * 60e3).unref();
}

function stats() {
  return { enabled: enabled(), from: process.env.MAIL_FROM ? process.env.MAIL_FROM.replace(/^(.).*(@.*)$/, '$1•••$2') : null, today: sentToday(), limit: DAILY(),
    week: q.get("SELECT COUNT(*) AS n FROM email_log WHERE sent_at > datetime('now', '-7 days')").n,
    optedOut: q.get('SELECT COUNT(*) AS n FROM users WHERE email_opt_out = 1').n };
}

/** E-mail de test (admin) : envoie le message de bienvenue à l'adresse de l'admin, sans le compter comme déjà envoyé. */
async function test(user) {
  if (!enabled()) throw Object.assign(new Error('Ajoute d’abord BREVO_API_KEY et MAIL_FROM dans les variables d’environnement de Render.'), { status: 400 });
  await deliver(user, 'welcome', { credits: 3 });
}

module.exports = { enabled, event, sweep, start, unsubscribe, setOptOut, stats, test, MARKETING };
