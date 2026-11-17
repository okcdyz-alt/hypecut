// Sous-titres automatiques : transcription de l'extrait (faster-whisper, gratuit, sur le serveur)
// puis fichier ASS « mot par mot » (le mot prononcé passe en jaune), incrusté par ffmpeg.
const fs = require('fs');
const path = require('path');
const { run, FFMPEG } = require('./media');

const PY = process.env.PYTHON_PATH || 'python3';
const SCRIPT = path.join(__dirname, 'transcribe.py');

/** Transcrit le passage [start, end] de la vidéo. Renvoie [{ w, s, e }] avec des temps relatifs au début du clip. */
// Une seule transcription à la fois : le serveur a peu de mémoire.
let chain = Promise.resolve();
function transcribe(file, start, end, tmpBase) {
  const p = chain.then(() => transcribeNow(file, start, end, tmpBase));
  chain = p.catch(() => {});
  return p;
}

async function transcribeNow(file, start, end, tmpBase) {
  const wav = `${tmpBase}.wav`;
  try {
    await run(FFMPEG, ['-v', 'error', '-y', '-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', wav], { timeoutMs: 120e3 });
    let out = '';
    await run(PY, [SCRIPT, wav], { onStdout: (d) => (out += d), timeoutMs: +process.env.WHISPER_TIMEOUT_MS || 6 * 60e3 });
    const j = JSON.parse(out.trim().split('\n').pop());
    return (j.words || []).filter((w) => w.e > w.s && w.s < end - start + 0.5);
  } finally {
    fs.rm(wav, { force: true }, () => {});
  }
}

const esc = (t) => String(t).replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
const assTime = (t) => {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60), cs = Math.floor((t % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

/** Regroupe les mots en courtes lignes (3 mots, 18 caractères max), coupées aux pauses et à la ponctuation. */
function groupWords(words) {
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const len = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    if (cur.length && (cur.length >= 3 || len > 18 || w.s - prev.e > 0.6)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  }
  flush();
  return groups;
}

/** Fichier ASS pour une vidéo W×H, sous-titres centrés à la hauteur y. */
function buildAss(words, { W, H, y, duration, fontName }) {
  const fs1 = Math.round((W > H ? H * 0.075 : W * 0.085));
  const outline = Math.max(3, Math.round(fs1 * 0.09));
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,${fontName},${fs1},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,${outline},${Math.round(outline * 0.6)},5,${Math.round(W * 0.06)},${Math.round(W * 0.06)},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  // La ponctuation seule est collée au mot d'avant
  const clean = [];
  for (const w of words) {
    const t = esc(w.w).toUpperCase();
    if (!t) continue;
    if (/^[.,!?…:;»”"')\]-]+$/.test(t) && clean.length) { clean[clean.length - 1].w += t; clean[clean.length - 1].e = Math.max(clean[clean.length - 1].e, w.e); continue; }
    clean.push({ ...w, w: t });
  }
  const groups = groupWords(clean);
  groups.forEach((g, gi) => {
    const next = groups[gi + 1];
    const gEnd = Math.min(duration, next ? Math.min(next[0].s, g[g.length - 1].e + 0.5) : g[g.length - 1].e + 0.6);
    g.forEach((w, i) => {
      const s = i === 0 ? w.s : w.s;
      const e = i < g.length - 1 ? g[i + 1].s : gEnd;
      if (e <= s) return;
      const text = g.map((x, k) => (k === i ? `{\\c&H3DD2FF&\\fscx108\\fscy108}${x.w}{\\c&HFFFFFF&\\fscx100\\fscy100}` : x.w)).join(' ');
      lines.push(`Dialogue: 0,${assTime(s)},${assTime(e)},Sub,,0,0,0,,{\\pos(${Math.round(W / 2)},${y})}${text}`);
    });
  });
  return head + lines.join('\n') + '\n';
}

module.exports = { transcribe, buildAss, groupWords };
