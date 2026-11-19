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

async function ytdlpInfo(url) {
  let out = '';
  await run(YTDLP, ['-J', '--no-playlist', '--no-warnings', ...cookieArgs(), url], { onStdout: (d) => (out += d), timeoutMs: 90e3 });
  return JSON.parse(out);
}

/**
 * Télécharge une VOD/un clip Twitch ou Kick.
 * Longue vidéo (> proxyAfterSec) : on récupère une version légère (proxyHeight) pour l'analyse ;
 * les extraits choisis sont retéléchargés en pleine qualité au moment de l'export (downloadSegment).
 * Renvoie { file, proxy, offset, url }.
 */
async function downloadPlatform(src, dest, { maxDurationSec, maxHeight, proxyHeight, proxyAfterSec = 1800, onProgress, onInfo, tooLong, range }) {
  const diagnose = require('./diagnose');
  let info;
  try { info = await ytdlpInfo(src.url); } catch (e) { throw diagnose.platformFailure(e, src.platform); }
  if (info.is_live) throw diagnose.platformFailure(new Error('is_live'), src.platform);
  // Passage choisi : on ne télécharge que lui
  let section = null;
  if (range && info.duration) {
    if (range.start >= info.duration - 1) throw userError(`Le début du passage (${diagnose.clock(range.start)}) est après la fin de la vidéo, qui dure ${diagnose.clock(info.duration)}.`);
    const end = Math.min(range.end ?? info.duration, info.duration, range.start + maxDurationSec);
    if (range.start > 0 || end < info.duration) section = { start: range.start, end };
  }
  const length = section ? section.end - section.start : info.duration;
  if (length && length > maxDurationSec + 5) throw tooLong ? tooLong(length) : userError(`Cette vidéo dure ${Math.round(length / 60)} min : ton offre accepte jusqu’à ${Math.round(maxDurationSec / 60)} min.`);
  onInfo && onInfo({ title: info.title || null, duration: info.duration || null });
  const proxy = !!(proxyHeight && length && length > proxyAfterSec && proxyHeight < maxHeight);
  const h = proxy ? proxyHeight : maxHeight;
  const fmt = `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`;
  const base = dest.replace(/\.[a-z0-9]+$/i, '');
  try {
    await run(YTDLP, ['-f', fmt, '--merge-output-format', 'mp4', '--no-playlist', '--no-part', '--newline', '--no-warnings',
      ...(section ? ['--download-sections', `*${section.start.toFixed(1)}-${section.end.toFixed(1)}`] : []),
      '--concurrent-fragments', '4', ...cookieArgs(), '-o', `${base}.%(ext)s`, src.url], {
      timeoutMs: 4 * 3600e3,
      onStdout: (d) => { const m = /\[download\]\s+([\d.]+)%/.exec(String(d)); if (m && onProgress) onProgress(+m[1] / 100); },
    });
  } catch (e) { throw diagnose.platformFailure(e, src.platform); }
  const dir = path.dirname(base);
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => f.startsWith(base + '.') && !/\.(part|ytdl|json)$/.test(f));
  if (!file) throw diagnose.platformFailure(new Error('aucun fichier produit'), src.platform);
  return { file, proxy, offset: section ? section.start : 0, url: src.url };
}

/** Retélécharge un passage précis (secondes dans la VOD d'origine) en pleine qualité, pour l'export. */
async function downloadSegment(url, start, end, dest, maxHeight) {
  const fmt = `bv*[height<=${maxHeight}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]`;
  const base = dest.replace(/\.[a-z0-9]+$/i, '');
  await run(YTDLP, ['-f', fmt, '--merge-output-format', 'mp4', '--no-playlist', '--no-part', '--no-warnings',
    '--download-sections', `*${Math.max(0, start).toFixed(1)}-${end.toFixed(1)}`, '--force-keyframes-at-cuts',
    // ffmpeg réencode le passage : on limite ses fils, sinon il en ouvre un par cœur de la machine hôte et dépasse les 512 Mo
    '--downloader-args', 'ffmpeg_i:-threads 2', '--downloader-args', 'ffmpeg_o:-threads 2', '--postprocessor-args', 'ffmpeg:-threads 2',
    '--concurrent-fragments', '2', ...cookieArgs(), '-o', `${base}.%(ext)s`, url], { timeoutMs: 6 * 60e3 });
  const dir = path.dirname(base);
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => f.startsWith(base + '.') && !/\.(part|ytdl|json)$/.test(f));
  if (!file) throw new Error('segment introuvable');
  return file;
}

function userError(msg) { const e = new Error(msg); e.user = true; return e; }

module.exports = { classify, platformName, downloadDirect, downloadPlatform, downloadSegment, assertPublicHost, isPrivateIp, userError };
