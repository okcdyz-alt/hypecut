// Traitement vidéo avec ffmpeg : lecture des infos, analyse des moments forts, vignettes, rendu des clips.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Scoring = require('../public/scoring');
const Layouts = require('../public/layouts');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const FONT = [process.env.FONT_FILE, '/usr/share/fonts/hypecut/Anton-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']
  .filter(Boolean).find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });

function run(cmd, args, { onStdout, onStderr, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const timer = timeoutMs ? setTimeout(() => p.kill('SIGKILL'), timeoutMs) : null;
    p.stdout.on('data', (d) => onStdout && onStdout(d));
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); onStderr && onStderr(d); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(err);
      else reject(new Error(`${path.basename(cmd)} a échoué (${code}) : ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

async function probe(file) {
  let out = '';
  await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { onStdout: (d) => (out += d), timeoutMs: 60000 });
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) throw new Error('Aucune piste vidéo trouvée dans ce fichier.');
  let w = +v.width, h = +v.height;
  const rot = Math.abs(+(v.tags?.rotate || (v.side_data_list || []).find((s) => s.rotation !== undefined)?.rotation || 0));
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  const duration = +(j.format?.duration || v.duration || 0);
  if (!duration) throw new Error('Durée de la vidéo illisible.');
  const [fn, fd] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  const fps = fd ? fn / fd : 30;
  return {
    duration, width: w, height: h, hasAudio: !!a, fps: isFinite(fps) && fps > 0 ? fps : 30,
    vcodec: v.codec_name, container: j.format?.format_name || '',
    browserFriendly: v.codec_name === 'h264' && /mp4|mov/.test(j.format?.format_name || '') && (!a || a.codec_name === 'aac'),
  };
}

/** Analyse complète : son + image, puis calcul des moments forts. */
async function analyze(file, info, opts, onProgress) {
  const step = Math.max(0.5, info.duration / 1500);
  const audioP = info.hasAudio ? (async () => {
    const acc = Scoring.createAudioAccumulator(8000, step);
    let rest = Buffer.alloc(0);
    await run(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], {
      onStdout: (d) => {
        const buf = rest.length ? Buffer.concat([rest, d]) : d;
        const n = buf.length >> 1;
        const f = new Float32Array(n);
        for (let i = 0; i < n; i++) f[i] = buf.readInt16LE(i * 2) / 32768;
        acc.push(f);
        rest = buf.subarray(n * 2);
      },
    });
    return acc.finish();
  })() : Promise.resolve(null);

  const fw = 64, fh = 36, fsz = fw * fh;
  const frames = Scoring.createFrameAccumulator();
  let frest = Buffer.alloc(0), count = 0;
  const total = Math.ceil(info.duration / step);
  const videoP = run(FFMPEG, ['-v', 'error', ...(step >= 1 ? ['-skip_frame', 'nokey'] : []), '-i', file, '-an', '-vf', `fps=${(1 / step).toFixed(5)},scale=${fw}:${fh},format=gray`, '-f', 'rawvideo', 'pipe:1'], {
    onStdout: (d) => {
      let buf = frest.length ? Buffer.concat([frest, d]) : d;
      while (buf.length >= fsz) {
        frames.push(new Uint8Array(buf.subarray(0, fsz)));
        buf = buf.subarray(fsz);
        count++;
        if (count % 25 === 0 && onProgress) onProgress(Math.min(0.99, count / total));
      }
      frest = Buffer.from(buf);
    },
  });

  const [audio] = await Promise.all([audioP, videoP]);
  const vf = frames.finish();
  const feats = { motion: vf.motion, flash: vf.flash, audioDb: audio?.audioDb || null, onset: audio?.onset || null };
  const res = Scoring.analyzeFeatures(feats, { step, priority: opts.priority, duration: info.duration, clipLen: opts.clipLen, count: opts.count });
  return { step, ...res };
}

async function thumbnail(file, t, out, width = 480) {
  await run(FFMPEG, ['-v', 'error', '-y', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out], { timeoutMs: 60000 });
  return out;
}

async function makePreview(file, out, onProgress, duration) {
  await run(FFMPEG, ['-v', 'error', '-stats_period', '2', '-progress', 'pipe:2', '-y', '-i', file,
    '-vf', 'scale=-2:min(480\\,ih)', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], {
    timeoutMs: 6 * 3600e3,
    onStderr: (d) => { const m = /out_time_ms=(\d+)/.exec(String(d)); if (m && onProgress) onProgress(Math.min(1, m[1] / 1e6 / duration)); },
  });
  return out;
}

const hexColor = (c) => '0x' + String(c || '#000000').replace('#', '');
const circleAlpha = "geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='if(lte(hypot(X-W/2\\,Y-H/2)\\,W/2-1)\\,255\\,0)'";

/**
 * Rendu d'un clip selon un format. opts : { layout, res, fps, crf, camRect, focusX, corner, titleLines, watermark }
 */
async function renderClip(file, info, start, end, opts, out, onProgress) {
  const dur = Math.max(0.5, end - start);
  const comp = Layouts.compose(opts.layout, info.width, info.height, opts);
  const { W, H, ops } = comp;
  const fps = opts.fps || 30;
  const videoOps = ops.filter((o) => o.kind === 'video');
  const bgOp = ops.find((o) => o.kind === 'bg');
  const bg = bgOp && opts.bg ? opts.bg : null; // { file, width, height }
  const f = [];
  f.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${dur.toFixed(3)}[base]`);
  f.push(`[0:v]setpts=PTS-STARTPTS,fps=${fps},split=${videoOps.length}${videoOps.map((_, i) => `[s${i}]`).join('')}`);
  let cur = 'base', vi = 0, k = 0;
  for (const op of ops) {
    const lab = `l${k}`;
    if (op.kind === 'video') {
      let chain = `[s${vi}]crop=${op.src.w}:${op.src.h}:${op.src.x}:${op.src.y},scale=${op.dst.w}:${op.dst.h}:flags=bicubic,setsar=1`;
      if (op.effect === 'blur') {
        const sw = Math.max(32, Math.round(op.dst.w / 8 / 2) * 2), sh = Math.max(32, Math.round(op.dst.h / 8 / 2) * 2);
        chain = `[s${vi}]crop=${op.src.w}:${op.src.h}:${op.src.x}:${op.src.y},scale=${sw}:${sh}:flags=fast_bilinear,boxblur=8:2,scale=${op.dst.w}:${op.dst.h}:flags=bilinear,setsar=1,eq=brightness=-0.08:saturation=1.15`;
      }
      if (op.shape === 'circle') chain += `,format=yuva420p,${circleAlpha}`;
      f.push(`${chain}[${lab}]`);
      vi++;
    } else if (op.kind === 'bg') {
      if (bg) {
        const c = Layouts.cover({ x: 0, y: 0, w: bg.width, h: bg.height }, op.dst.w, op.dst.h, 0.5, 0.5);
        const cw = Math.max(2, Math.round(c.w / 2) * 2), ch = Math.max(2, Math.round(c.h / 2) * 2);
        f.push(`[1:v]setpts=PTS-STARTPTS,fps=${fps},crop=${cw}:${ch}:${Math.round(c.x)}:${Math.round(c.y)},scale=${op.dst.w}:${op.dst.h}:flags=bicubic,setsar=1[${lab}]`);
      } else {
        f.push(`color=c=0x120c1f:s=${op.dst.w}x${op.dst.h}:r=${fps}:d=${dur.toFixed(3)}[${lab}]`);
      }
    } else if (op.kind === 'fill') {
      let chain = `color=c=${hexColor(op.color)}:s=${op.dst.w}x${op.dst.h}:r=${fps}:d=${dur.toFixed(3)}`;
      if (op.shape === 'circle') chain += `,format=yuva420p,${circleAlpha}`;
      f.push(`${chain}[${lab}]`);
    } else continue;
    f.push(`[${cur}][${lab}]overlay=${op.dst.x}:${op.dst.y}:format=auto[c${k}]`);
    cur = `c${k}`; k++;
  }

  // Titre (une ligne = un drawtext centré, texte lu depuis un fichier : aucun souci d'échappement)
  const tmpFiles = [];
  const lines = opts.titleLines || [];
  if (lines.length && FONT) {
    const fs1 = Math.round(W * (W > H ? 0.045 : 0.068));
    const lh = Math.round(fs1 * 1.32);
    const blockH = lh * lines.length;
    let y0 = opts.titlePos ? opts.titlePos.y * H - blockH / 2 : comp.title.anchor === 'center' ? comp.title.y - blockH / 2 : comp.title.y;
    y0 = Math.max(8, Math.min(H - blockH - 8, y0));
    const pad = Math.round(fs1 * 0.28) + 8;
    const xExpr = opts.titlePos ? `max(${pad}\\,min(w-text_w-${pad}\\,${Math.round(opts.titlePos.x * W)}-text_w/2))` : '(w-text_w)/2';
    lines.forEach((line, i) => {
      const tf = `${out}.t${i}.txt`;
      fs.writeFileSync(tf, line);
      tmpFiles.push(tf);
      const lab = `t${i}`;
      f.push(`[${cur}]drawtext=fontfile='${FONT}':textfile='${tf}':fontsize=${fs1}:fontcolor=white:box=1:boxcolor=black@0.62:boxborderw=${Math.round(fs1 * 0.28)}:x=${xExpr}:y=${Math.round(y0 + i * lh)}[${lab}]`);
      cur = lab;
    });
  }
  if (opts.subtitleWords && opts.subtitleWords.length) {
    const assFile = `${out}.ass`;
    const fontName = FONT && /anton/i.test(FONT) ? 'Anton' : 'DejaVu Sans';
    fs.writeFileSync(assFile, require('./subtitles').buildAss(opts.subtitleWords, { W, H, y: opts.subPos ? opts.subPos.y * H : Layouts.subtitleY(comp, lines.length), x: opts.subPos ? opts.subPos.x * W : null, duration: dur, fontName }));
    tmpFiles.push(assFile);
    const fontsdir = FONT ? `:fontsdir='${path.dirname(FONT)}'` : '';
    f.push(`[${cur}]ass=filename='${assFile}'${fontsdir}[subs]`);
    cur = 'subs';
  }
  if (opts.progressBar) {
    const bh = Math.max(6, Math.round(H * 0.009));
    f.push(`color=c=0xff3d8b:s=${W}x${bh}:r=${fps}:d=${dur.toFixed(3)}[pbar]`);
    f.push(`[${cur}]drawbox=x=0:y=${H - bh}:w=${W}:h=${bh}:color=black@0.45:t=fill[pbt]`);
    f.push(`[pbt][pbar]overlay=x='-w+w*t/${dur.toFixed(3)}':y=${H - bh}:eval=frame[pbo]`);
    cur = 'pbo';
  }
  if (opts.watermark && FONT) {
    const fs2 = Math.round(Math.min(W, H) * 0.045);
    f.push(`[${cur}]drawtext=fontfile='${FONT}':text='HYPECUT':fontsize=${fs2}:fontcolor=white@0.72:shadowcolor=black@0.6:shadowx=2:shadowy=2:x=w-text_w-${Math.round(W * 0.04)}:y=h-text_h-${Math.round(H * (W < H ? 0.13 : 0.05))}[wm]`);
    cur = 'wm';
  }
  f.push(`[${cur}]format=yuv420p[vout]`);

  const args = ['-v', 'error', '-progress', 'pipe:2', '-y',
    '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', file,
    ...(bg ? ['-stream_loop', '-1', '-i', bg.file] : []),
    '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '0:a?',
    '-t', dur.toFixed(3), '-r', String(fps),
    '-filter_complex_threads', '1', '-threads', String(process.env.FFMPEG_THREADS || 2),
    '-c:v', 'libx264', '-preset', process.env.X264_PRESET || 'veryfast', '-crf', String(opts.crf || 21),
    '-x264-params', 'rc-lookahead=10:ref=2',
    '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart', out];
  try {
    await run(FFMPEG, args, {
      timeoutMs: 20 * 60e3,
      onStderr: (d) => { const m = /out_time_ms=(\d+)/.exec(String(d)); if (m && onProgress) onProgress(Math.min(1, m[1] / 1e6 / dur)); },
    });
  } finally {
    for (const t of tmpFiles) fs.rm(t, { force: true }, () => {});
  }
  return out;
}

module.exports = { probe, analyze, thumbnail, makePreview, renderClip, run, FFMPEG, FONT };
