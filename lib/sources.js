// Récupération de la vidéo source : lien direct (téléchargement protégé) ou plateformes (yt-dlp).
const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { run } = require('./media');

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const PLATFORM_HOSTS = /(^|\.)(youtube\.com|youtu\.be|twitch\.tv|drive\.google\.com|dropbox\.com|vimeo\.com|kick\.com|streamable\.com|medal\.tv|outplayed\.tv)$/i;

function classify(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw userError('Ce lien n’est pas valide.'); }
  if (!/^https?:$/.test(u.protocol)) throw userError('Le lien doit commencer par http:// ou https://');
  const host = u.hostname.toLowerCase();
  let platform = 'direct';
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) platform = 'youtube';
  else if (/(^|\.)twitch\.tv$/.test(host)) platform = 'twitch';
  else if (/(^|\.)kick\.com$/.test(host)) platform = 'kick';
  else if (PLATFORM_HOSTS.test(host)) platform = 'platform';
  return { url: u.toString(), host, platform };
}

const PLATFORM_NAMES = { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick' };
const platformName = (p) => PLATFORM_NAMES[p] || 'la plateforme';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
  return m ? isPrivateIp(m[1]) : false;
}

async function assertPublicHost(host) {
  if (net.isIP(host)) { if (isPrivateIp(host)) throw userError('Adresse non autorisée.'); return; }
  const addrs = await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw userError('Impossible de joindre ce site.');
  if (addrs.some((a) => isPrivateIp(a.address))) throw userError('Adresse non autorisée.');
}

/** Téléchargement direct d'un fichier vidéo, avec contrôle des redirections et de la taille. */
async function downloadDirect(url, dest, { maxBytes, onProgress }) {
  let current = url;
  let res;
  for (let hop = 0; hop < 6; hop++) {
    const u = new URL(current);
    if (!/^https?:$/.test(u.protocol)) throw userError('Redirection non autorisée.');
    await assertPublicHost(u.hostname);
    res = await fetch(current, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 HYPECUT' }, signal: AbortSignal.timeout(30 * 60e3) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location'), current).toString(); continue; }
    break;
  }
  if (!res || !res.ok) throw userError(`Le lien ne répond pas correctement (code ${res ? res.status : '?'}).`);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (/text\/html/.test(type)) throw userError('Ce lien mène à une page web, pas à un fichier vidéo. Colle un lien direct (.mp4) ou un lien YouTube/Twitch.');
  const len = +res.headers.get('content-length') || 0;
  if (len && len > maxBytes) throw userError(`Vidéo trop lourde pour ton offre (max ${Math.round(maxBytes / 1048576)} Mo).`);
  let got = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    got += c.length;
    if (got > maxBytes) body.destroy(userError(`Vidéo trop lourde pour ton offre (max ${Math.round(maxBytes / 1048576)} Mo).`));
    if (len && onProgress) onProgress(got / len);
  });
  await pipeline(body, fs.createWriteStream(dest));
  return dest;
}

function cookieArgs() {
  if (process.env.YTDLP_COOKIES_FILE) return ['--cookies', process.env.YTDLP_COOKIES_FILE];
  if (process.env.YTDLP_COOKIES) {
    const f = path.join(require('os').tmpdir(), 'hypecut-cookies.txt');
    if (!fs.existsSync(f)) fs.writeFileSync(f, process.env.YTDLP_COOKIES.replace(/\\n/g, '\n'));
    return ['--cookies', f];
  }
  return [];
}

function friendlyYtdlpError(err, platform) {
  const m = String(err.message || err);
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(m)) return userError('YouTube bloque temporairement les téléchargements depuis nos serveurs. Réessaie plus tard ou importe ton fichier.');
  if (/Private video|members-only|This video is private/i.test(m)) return userError('Cette vidéo est privée ou réservée aux abonnés.');
  if (/is not currently live|is_live|live event/i.test(m)) return userError('Impossible de découper un live en cours : attends la fin du stream (VOD).');
  if (/Unsupported URL/i.test(m)) return userError('Ce lien n’est pas pris en charge.');
  if (/Video unavailable|404|not found/i.test(m)) return userError('Vidéo introuvable ou supprimée.');
  if (platform === 'kick' && /403|Cloudflare|blocked/i.test(m)) return userError('Kick bloque temporairement les téléchargements depuis nos serveurs. Réessaie dans quelques minutes ou importe ton fichier.');
  return userError(`Récupération impossible depuis ${PLATFORM_NAMES[platform] || 'ce site'}.`);
}

async function ytdlpInfo(url) {
  let out = '';
  await run(YTDLP, ['-J', '--no-playlist', '--no-warnings', ...cookieArgs(), url], { onStdout: (d) => (out += d), timeoutMs: 90e3 });
  return JSON.parse(out);
}

async function downloadPlatform(src, dest, { maxDurationSec, maxHeight, onProgress, onInfo }) {
  let info;
  try { info = await ytdlpInfo(src.url); } catch (e) { throw friendlyYtdlpError(e, src.platform); }
  if (info.is_live) throw userError('Impossible de découper un live en cours : attends la fin du stream (VOD).');
  if (info.duration && info.duration > maxDurationSec) {
    throw userError(`Cette vidéo dure ${Math.round(info.duration / 60)} min : ton offre accepte jusqu’à ${Math.round(maxDurationSec / 60)} min.`);
  }
  onInfo && onInfo({ title: info.title || null, duration: info.duration || null });
  const h = maxHeight;
  const fmt = `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`;
  const base = dest.replace(/\.[a-z0-9]+$/i, '');
  try {
    await run(YTDLP, ['-f', fmt, '--merge-output-format', 'mp4', '--no-playlist', '--no-part', '--newline', '--no-warnings',
      '--concurrent-fragments', '4', ...cookieArgs(), '-o', `${base}.%(ext)s`, src.url], {
      timeoutMs: 4 * 3600e3,
      onStdout: (d) => { const m = /\[download\]\s+([\d.]+)%/.exec(String(d)); if (m && onProgress) onProgress(+m[1] / 100); },
    });
  } catch (e) { throw friendlyYtdlpError(e, src.platform); }
  const dir = path.dirname(base);
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => f.startsWith(base + '.') && !/\.(part|ytdl|json)$/.test(f));
  if (!file) throw userError('Le téléchargement n’a produit aucun fichier.');
  return file;
}

function userError(msg) { const e = new Error(msg); e.user = true; return e; }

module.exports = { classify, platformName,downloadDirect, downloadPlatform, assertPublicHost, isPrivateIp, userError };
