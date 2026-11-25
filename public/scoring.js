/* HYPECUT — détection des moments forts, v2 (partagé navigateur + serveur).
 *
 * Ce qui fait un bon clip de live, dans l'ordre :
 *   1. la RÉACTION du streamer (il crie, il rit, il s'emballe) — c'est ce que le public partage ;
 *   2. un ÉVÉNEMENT de jeu (explosion, impact, action soudaine), surtout s'il est suivi d'une réaction ;
 *   3. une MONTÉE de tension qui débouche sur un pic.
 * Tout est mesuré PAR RAPPORT AU CONTEXTE (les ~90 s autour) : une musique forte et continue ou un
 * jeu bruyant en permanence ne sont pas des moments forts ; un changement brutal, si.
 * Les passages morts (menu, pause, écran fixe, silence, « je reviens ») sont pénalisés.
 *
 * Entrée : séries échantillonnées (audio tous les `audioStep` s, image tous les `videoStep` s) :
 *   audioDb, onset              (v1, toujours fournis)
 *   voice, high, low, burst, peak (v2 : voix, aigus/cris, graves/explosions, rires, crête)
 *   motion, flash               (image)
 * Sortie : courbe d'intensité 0-100 + clips proposés (début/fin calés sur des respirations).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HypeScoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // v = voix qui s'emballe, s = cri, r = rires, l = volume, o = impacts, b = graves/explosion, m = action, f = flash
  const WEIGHTS = {
    balanced: { v: 0.26, s: 0.14, r: 0.18, l: 0.05, o: 0.08, b: 0.07, m: 0.17, f: 0.05 },
    audio:    { v: 0.31, s: 0.18, r: 0.22, l: 0.06, o: 0.09, b: 0.06, m: 0.05, f: 0.03 },
    action:   { v: 0.12, s: 0.07, r: 0.06, l: 0.07, o: 0.16, b: 0.12, m: 0.28, f: 0.12 },
  };
  const LABELS = {
    a: '🔊 Pic sonore',
    o: '💥 Impact',
    m: '🏎️ Action',
    f: '⚡ Flash / explosion',
    v: '🗣️ Le streamer s’enflamme',
    s: '😱 Cri / grosse réaction',
    r: '😂 Fou rire',
    b: '💣 Explosion',
    e: '🎯 Action + réaction',
  };
  const LABEL_OF = { v: LABELS.v, s: LABELS.s, r: LABELS.r, l: LABELS.a, o: LABELS.o, b: LABELS.b, m: LABELS.m, f: LABELS.f };

  // ------------------------------------------------------------------ outils de séries
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  function fit(a, n) { const o = (a || []).slice(0, n); while (o.length < n) o.push(o.length ? o[o.length - 1] : 0); return o; }
  function quantile(arr, q) {
    if (!arr.length) return 0;
    const s = Float64Array.from(arr).sort();
    return s[clampN(Math.floor(q * (s.length - 1)), 0, s.length - 1)];
  }
  function smooth(arr, sigma) {
    if (sigma < 0.5) return arr.slice();
    const r = Math.ceil(sigma * 3);
    const k = [];
    let ks = 0;
    for (let i = -r; i <= r; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(w); ks += w; }
    const out = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      let s = 0, ws = 0;
      for (let j = -r; j <= r; j++) {
        const idx = i + j;
        if (idx < 0 || idx >= arr.length) continue;
        s += arr[idx] * k[j + r]; ws += k[j + r];
      }
      out[i] = ws ? s / ws : 0;
    }
    return out;
  }
  /** Moyenne glissante centrée (fenêtre 2r+1), O(n). */
  function boxMean(arr, r) {
    const n = arr.length, pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + arr[i];
    const out = new Array(n);
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - r), b = Math.min(n, i + r + 1); out[i] = (pre[b] - pre[a]) / (b - a); }
    return out;
  }
  /** Médiane glissante approchée : médiane de blocs, interpolée (rapide même sur 8 h). */
  function rollingMedian(arr, r) {
    const n = arr.length;
    if (!n) return [];
    const blk = Math.max(1, Math.round(r / 3));
    const centers = [], meds = [];
    for (let c = 0; c < n; c += blk) {
      const a = Math.max(0, c - r), b = Math.min(n, c + r + 1);
      centers.push(c); meds.push(quantile(arr.slice(a, b), 0.5));
    }
    const out = new Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (j < centers.length - 2 && centers[j + 1] <= i) j++;
      const c0 = centers[j], c1 = centers[Math.min(j + 1, centers.length - 1)];
      const k = c1 > c0 ? clampN((i - c0) / (c1 - c0), 0, 1) : 0;
      out[i] = meds[j] + (meds[Math.min(j + 1, meds.length - 1)] - meds[j]) * k;
    }
    return out;
  }
  /** Écart robuste global (MAD) — l'unité de « surprise ». */
  function robustScale(arr) {
    const med = quantile(arr, 0.5);
    const mad = quantile(arr.map((v) => Math.abs(v - med)), 0.5) * 1.4826;
    const sd = (() => { let m = 0; for (const v of arr) m += v; m /= arr.length || 1; let s = 0; for (const v of arr) s += (v - m) * (v - m); return Math.sqrt(s / (arr.length || 1)); })();
    // séries « creuses » (flashs, attaques) : la MAD vaut ~0, on prend l'écart des valeurs hautes
    return Math.max(mad, sd * 0.5, (quantile(arr, 0.95) - med) * 0.5, 1e-6);
  }
  /**
   * Surprise d'une série : écart au contexte local (médiane ~90 s) + un peu d'écart global.
   * Une valeur haute ne compte que si elle tranche avec ce qui l'entoure.
   */
  function surprise(arr, grid, ctxSec = 90) {
    const n = arr.length;
    if (!n) return [];
    const r = Math.max(3, Math.round(ctxSec / 2 / grid));
    // le contexte ne descend jamais sous le niveau « habituel » : sinon, juste avant une pause ou un silence,
    // un niveau normal paraîtrait exceptionnel
    const floorQ = quantile(arr, 0.4);
    const base = rollingMedian(arr, r).map((v) => Math.max(v, floorQ));
    const sc = robustScale(arr);
    const gmed = quantile(arr, 0.5);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = clampN(0.75 * (arr[i] - base[i]) / sc + 0.25 * (arr[i] - gmed) / sc, -3, 6);
    return out;
  }
  /** Rééchantillonne une série (pas `from`) sur la grille (pas `to`), par max ou moyenne. */
  function resample(arr, from, to, n, mode) {
    if (!arr || !arr.length) return null;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i * to) / from), b = Math.max(a + 1, Math.floor(((i + 1) * to) / from));
      if (from >= to) { out[i] = arr[clampN(Math.floor(((i + 0.5) * to) / from), 0, arr.length - 1)]; continue; }
      let s = 0, m = -Infinity, c = 0;
      for (let j = a; j < b && j < arr.length; j++) { s += arr[j]; if (arr[j] > m) m = arr[j]; c++; }
      out[i] = c ? (mode === 'max' ? m : s / c) : arr[arr.length - 1];
    }
    return out;
  }
  const pos = (z) => Math.max(0, z);

  // ------------------------------------------------------------------ score
  function score(feats, step, priority, opts = {}) {
    const aStep = feats.audioStep || step, vStep = feats.videoStep || step;
    const duration = opts.duration || Math.max((feats.motion || []).length * vStep, (feats.audioDb || []).length * aStep);
    const grid = opts.grid || Math.max(0.5, Math.min(aStep, vStep, step), duration / 12000);
    const n = Math.max(1, Math.round(duration / grid));
    const hasAudio = !!(feats.audioDb && feats.audioDb.length > 2);
    const hasV2 = hasAudio && !!(feats.voice && feats.voice.length);
    const A = (k, mode) => fit(resample(feats[k], aStep, grid, n, mode), n);
    const V = (k, mode) => fit(resample(feats[k], vStep, grid, n, mode), n);

    const zeros = new Array(n).fill(0);
    const motionRaw = V('motion', 'max');
    const flashRaw = V('flash', 'max');
    const loud = hasAudio ? A(hasV2 && feats.peak ? 'peak' : 'audioDb', 'max') : zeros;
    const loudMean = hasAudio ? A('audioDb', 'mean') : zeros;

    // Composantes « surprise »
    const c = {};
    c.l = hasAudio ? surprise(loud, grid) : zeros;
    c.o = hasAudio ? surprise(A('onset', 'max'), grid, 60) : zeros;
    if (hasV2) {
      const voice = A('voice', 'max'), high = A('high', 'max'), low = A('low', 'max'), burst = A('burst', 'max');
      const zV = surprise(voice, grid);
      c.v = zV;
      // cri : la voix monte ET devient aiguë (part d'aigus au-dessus de son habitude)
      const hiRatio = high.map((h, i) => h - voice[i]);
      const zH = surprise(hiRatio, grid);
      c.s = zV.map((z, i) => (z > 0.5 ? Math.min(z, 4) * 0.5 + pos(zH[i]) * 0.8 : 0));
      // rires : rafales syllabiques régulières dans la voix, voix au-dessus de son niveau habituel
      const zB = surprise(burst, grid, 60);
      c.r = zB.map((z, i) => (zV[i] > 0.2 ? pos(z) * (0.6 + 0.4 * Math.min(1, zV[i] / 2)) : pos(z) * 0.25));
      // explosion : graves qui bondissent
      c.b = surprise(low, grid, 60);
    } else { c.v = c.l; c.s = zeros; c.r = zeros; c.b = zeros; }
    // mouvement : on ignore les simples coupes de plan isolées (un seul échantillon énorme)
    const motionCl = motionRaw.map((v, i) => Math.min(v, Math.max(motionRaw[i - 1] ?? v, motionRaw[i + 1] ?? v) * 1.6 + 1));
    c.m = surprise(smooth(motionCl, 1 / grid), grid, 120);
    c.f = surprise(flashRaw, grid, 60);

    const w = Object.assign({}, WEIGHTS[priority] || WEIGHTS.balanced);
    if (!hasAudio) { const sa = w.v + w.s + w.r + w.l + w.o + w.b; w.m += sa * 0.7; w.f += sa * 0.3; w.v = w.s = w.r = w.l = w.o = w.b = 0; }
    else if (!hasV2) { w.l += w.v * 0.6; w.o += w.v * 0.4 + w.s + w.r + w.b; w.v = w.s = w.r = w.b = 0; }

    // Passages morts : image figée ET son plat sur ~20 s (menu, pause, écran « je reviens »), ou silence prolongé
    const still = boxMean(motionRaw.map((v) => v), Math.max(2, Math.round(10 / grid)));
    const stillTh = quantile(motionRaw, 0.12) * 1.15 + 0.15;
    const quietTh = hasAudio ? quantile(loudMean, 0.15) : -Infinity;
    const quiet = hasAudio ? boxMean(loudMean, Math.max(2, Math.round(10 / grid))) : zeros;
    const dead = new Array(n);
    for (let i = 0; i < n; i++) {
      const st = still[i] <= stillTh, qu = hasAudio && quiet[i] <= quietTh;
      dead[i] = st && qu ? 1 : qu ? 0.45 : st ? (hasAudio ? 0.3 : 0.6) : 0;
    }

    // Plateaux : un niveau qui reste très haut plus de 25 s (musique, cinématique, son du jeu poussé)
    // n'est pas une réaction ; on garde l'attaque mais on éteint la suite
    const plateau = new Array(n).fill(1);
    const maxRun = Math.round(25 / grid);
    const zs = { l: smooth(c.l, 3 / grid), v: smooth(c.v, 3 / grid) };
    for (const k of ['l', 'v']) {
      let s0 = -1;
      for (let i = 0; i <= n; i++) {
        const on = i < n && zs[k][i] > 0.9;
        if (on && s0 < 0) s0 = i;
        if (!on && s0 >= 0) {
          if (i - s0 > maxRun) {
            for (let j = s0; j < i; j++) plateau[j] = Math.min(plateau[j], 0.35);
            // l'attaque d'un plateau (début de musique / cinématique) compte moins aussi
            for (let j = Math.max(0, s0 - Math.round(4 / grid)); j < s0 + Math.round(4 / grid) && j < n; j++) plateau[j] = Math.min(plateau[j], 0.6);
          }
          s0 = -1;
        }
      }
    }
    for (const k of ['v', 's', 'r', 'l', 'o', 'b', 'f']) c[k] = c[k].map((z, i) => (z > 0 ? z * plateau[i] : z));

    // Combinaison : on récompense les pics positifs, avec un bonus quand plusieurs signaux coïncident
    const keys = ['v', 's', 'r', 'l', 'o', 'b', 'm', 'f'];
    const raw = new Array(n);
    const audioEv = new Array(n), visEv = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const k of keys) { const z = c[k][i]; s += w[k] * (z > 0 ? Math.pow(z, 1.15) : z * 0.25); }
      audioEv[i] = Math.max(pos(c.v[i]), pos(c.s[i]), pos(c.r[i]));
      visEv[i] = Math.max(pos(c.m[i]), pos(c.f[i]) * 0.6, pos(c.b[i]) * 0.8, pos(c.o[i]) * 0.5);
      raw[i] = s;
    }
    // Action puis réaction (0 à 4 s plus tard) : la signature des meilleurs clips de live
    const lag = Math.max(1, Math.round(4 / grid));
    const react = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (visEv[i] < 1) continue;
      let best = 0;
      for (let j = i; j <= Math.min(n - 1, i + lag); j++) best = Math.max(best, audioEv[j]);
      if (best > 1) for (let j = i; j <= Math.min(n - 1, i + lag); j++) react[j] = Math.max(react[j], Math.min(visEv[i], best));
    }
    for (let i = 0; i < n; i++) {
      raw[i] += 0.12 * Math.min(3, Math.min(audioEv[i], visEv[i])) + 0.14 * Math.min(3, react[i]);
      raw[i] -= 0.9 * dead[i];
    }

    // Courbe lissée (on regarde ~2 s autour) puis normalisée 0-100
    const sm = smooth(raw, 1.2 / grid);
    const lo = quantile(sm, 0.1);
    // plancher absolu : sur une vidéo plate, rien n'atteint 100 (et les clips sans intérêt sont écartés)
    const hi = Math.max(quantile(sm, 0.995), lo + 1.4);
    const series = sm.map((v) => Math.round(clampN((v - lo) / ((hi - lo) || 1), 0, 1) * 100));
    return { series, sm, comps: c, w, grid, dead, react, loudMean, voice: hasV2 ? A('voice', 'mean') : loudMean, hasAudio };
  }

  function reasonsAt(i, sc) {
    const { comps, w, react } = sc;
    const r = Math.max(1, Math.round(2 / sc.grid));
    const parts = [];
    for (const key of Object.keys(LABEL_OF)) {
      if (!w[key]) continue;
      let best = 0;
      for (let j = i - r; j <= i + r; j++) if (comps[key][j] !== undefined) best = Math.max(best, comps[key][j]);
      parts.push({ key, v: w[key] * best });
    }
    let reactMax = 0;
    for (let j = i - r * 2; j <= i + r * 2; j++) if (react[j] !== undefined) reactMax = Math.max(reactMax, react[j]);
    parts.sort((x, y) => y.v - x.v);
    const out = [];
    if (reactMax > 2.5) out.push(LABELS.e);
    for (const p of parts) { if (p.v > 0.12 && !out.includes(LABEL_OF[p.key])) out.push(LABEL_OF[p.key]); if (out.length >= 2) break; }
    return out.length ? out : ['🔥 Moment fort'];
  }

  /** Choisit les meilleurs moments sans chevauchement, avec des coupes propres. */
  function pickClips(scored, step, duration, clipLen, count, pool = false) {
    const { series, sm, grid, voice, dead } = scored;
    const n = series.length;
    if (!n) return [];
    const at = (t) => clampN(Math.round(t / grid - 0.5), 0, n - 1);
    if (duration <= clipLen + 1) {
      let best = 0;
      for (let i = 1; i < n; i++) if (series[i] > series[best]) best = i;
      return [{ start: 0, end: +duration.toFixed(2), peak: +((best + 0.5) * grid).toFixed(2), hype: series[best], reasons: reasonsAt(best, scored) }];
    }
    const L = clipLen, Ln = Math.max(2, Math.round(L / grid));

    // 1) Candidats : maxima locaux (rayon ~L/3)
    const rad = Math.max(1, Math.round(L / 3 / grid));
    const cands = [];
    for (let i = 0; i < n; i++) {
      if (series[i] < 15 || i * grid < 3) continue; // les toutes premières secondes : effets de bord
      let isMax = true;
      for (let j = Math.max(0, i - rad); j <= Math.min(n - 1, i + rad); j++) if (sm[j] > sm[i]) { isMax = false; break; }
      if (isMax) cands.push(i);
    }

    // 2) Pour chaque pic : placer la fenêtre (montée avant, réaction après) et noter la fenêtre entière
    const quietAt = (t) => { const i = at(t); let s = 0, c = 0; for (let j = i - 1; j <= i + 1; j++) if (voice[j] !== undefined) { s += voice[j]; c++; } return c ? s / c : 0; };
    const vLo = quantile(voice, 0.2), vHi = quantile(voice, 0.9) - vLo || 1;
    const scoredC = cands.map((i) => {
      const peakT = (i + 0.5) * grid;
      // début de la montée : on remonte tant que l'intensité reste au-dessus de 40 % du pic
      let k = i;
      const floor = sm[i] * 0.4;
      while (k > 0 && (i - k) * grid < L * 0.6 && sm[k - 1] > floor) k--;
      const rise = (i - k) * grid;
      // le pic tombe entre 35 % et 65 % du clip : de quoi comprendre ce qui arrive ET voir la réaction
      const lead = clampN(rise + 2, L * 0.35, L * 0.65);
      let start = clampN(peakT - lead, 0, duration - L);
      // coupe propre : on décale de ±3 s pour commencer et finir sur une respiration (voix basse)
      let bestS = start, bestQ = Infinity;
      for (let d = -3; d <= 3; d += 0.5) {
        const s = clampN(start + d, 0, duration - L);
        if (peakT - s < L * 0.25 || peakT - s > L * 0.75) continue;
        const q = (quietAt(s) - vLo) / vHi + (quietAt(s + L) - vLo) / vHi * 0.6 + Math.abs(d) * 0.04;
        if (q < bestQ) { bestQ = q; bestS = s; }
      }
      start = bestS;
      const a = at(start), b = Math.min(n, a + Ln);
      const win = series.slice(a, b);
      const sorted = win.slice().sort((x, y) => y - x);
      const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
      const topMean = top.reduce((s, v) => s + v, 0) / top.length;
      let deadFrac = 0; for (let j = a; j < b; j++) deadFrac += dead[j] > 0.5 ? 1 : 0; deadFrac /= (b - a) || 1;
      const value = 0.6 * series[i] + 0.4 * topMean - 35 * Math.max(0, deadFrac - 0.25);
      return { i, start, peakT, value };
    }).sort((x, y) => y.value - x.value);

    // 3) Sélection gloutonne : pas de chevauchement, un léger étalement sur toute la vidéo
    const clips = [];
    const best = scoredC.length ? scoredC[0].value : 0;
    for (const cand of scoredC) {
      if (clips.length >= count) break;
      if (clips.some((c) => cand.start < c.end + 1 && cand.start + L > c.start - 1)) continue;
      const near = clips.some((c) => Math.abs(c.peak - cand.peakT) < 90);
      const v = cand.value * (near ? 0.9 : 1);
      // On préfère moins de clips à des clips sans intérêt
      if (clips.length >= 1 && (pool ? (v < best * 0.25 || series[cand.i] < 20) : (v < best * 0.42 || series[cand.i] < 30))) continue;
      clips.push({
        start: +cand.start.toFixed(2),
        end: +(cand.start + L).toFixed(2),
        peak: +cand.peakT.toFixed(2),
        hype: series[cand.i],
        reasons: reasonsAt(cand.i, scored),
        _v: v,
      });
    }
    clips.sort((x, y) => y._v - x._v);
    if (!pool) for (const c of clips) delete c._v;
    return clips;
  }

  /** Réduit la courbe pour l'affichage (≤ 1500 points). */
  function displaySeries(series, grid, max = 1500) {
    if (series.length <= max) return { series, step: grid };
    const f = Math.ceil(series.length / max);
    const out = [];
    for (let i = 0; i < series.length; i += f) { let m = 0; for (let j = i; j < Math.min(series.length, i + f); j++) m = Math.max(m, series[j]); out.push(m); }
    return { series: out, step: grid * f };
  }

  function analyzeFeatures(feats, opts) {
    const scored = score(feats, opts.step, opts.priority, { duration: opts.duration });
    // opts.pool : nombre de candidats à garder pour une 2e passe (serveur) ; sinon sélection directe
    const clips = pickClips(scored, opts.step, opts.duration, opts.clipLen, opts.pool || opts.count, !!opts.pool);
    const d = displaySeries(scored.series, scored.grid);
    return { series: d.series, step: d.step, clips };
  }

  // ------------------------------------------------------------------ mesures audio
  /** Filtre biquad (RBJ). type : 'lp' | 'hp' | 'bp'. */
  function biquad(type, sr, f0, Q = 0.707) {
    const w0 = 2 * Math.PI * Math.min(f0, sr * 0.45) / sr, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return (x) => { const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  }

  /**
   * Accumulateur audio : reçoit des échantillons mono, produit par tranche de `step` s :
   *  audioDb (volume moyen), onset (attaques), peak (crête sur 50 ms), voice (bande de la voix 300-3400 Hz),
   *  high (aigus 2-4 kHz : cris), low (graves < 150 Hz : explosions), burst (rafales syllabiques : rires).
   */
  function createAudioAccumulator(sampleRate, step) {
    // On ramène le signal vers ~8 kHz (moyenne de blocs) : même coût et mêmes mesures partout
    const dec = Math.max(1, Math.floor(sampleRate / 8000));
    const sr = sampleRate / dec;
    const fVhp = biquad('hp', sr, 300), fVlp = biquad('lp', sr, 3400), fHi = biquad('hp', sr, 2000), fLo = biquad('lp', sr, 150);
    const sub = Math.max(1, Math.round(sr * 0.05));
    const perBin = Math.max(1, Math.round(sr * step));
    const audioDb = [], onset = [], peak = [], voice = [], high = [], low = [], burst = [];
    let dAcc = 0, dCnt = 0;
    let subSum = 0, sV = 0, sH = 0, sL = 0, subCount = 0, binCount = 0, prevE = null;
    let binE = 0, binSubs = 0, binFlux = 0, binPeak = 0, binV = 0, binH = 0, binL = 0;
    // enveloppe de la voix (20 Hz) pour repérer les rafales 3-8 Hz typiques du rire
    let envPrev = 0, envPrev2 = 0, envMean = 0, binBursts = 0;
    const db = (e) => 20 * Math.log10(e + 1e-5);
    function closeSub() {
      const k = subCount || 1;
      const e = Math.sqrt(subSum / k), ev = Math.sqrt(sV / k);
      // attaque mesurée en dB : indépendante du volume général (une musique forte n'est pas une suite d'impacts)
      const ed = db(e);
      if (prevE !== null) binFlux += Math.max(0, ed - prevE - 1.5);
      prevE = ed;
      binE += e; binV += ev; binH += Math.sqrt(sH / k); binL += Math.sqrt(sL / k); binSubs++;
      if (e > binPeak) binPeak = e;
      envMean = envMean * 0.995 + ev * 0.005;
      // pic local de l'enveloppe vocale, nettement au-dessus de son niveau moyen
      if (envPrev > envPrev2 && envPrev >= ev && envPrev > envMean * 1.4 && envPrev > 0.004) binBursts++;
      envPrev2 = envPrev; envPrev = ev;
      subSum = 0; sV = 0; sH = 0; sL = 0; subCount = 0;
    }
    function closeBin() {
      const k = binSubs || 1;
      audioDb.push(db(binE / k));
      onset.push(binFlux);
      peak.push(db(binPeak));
      voice.push(db(binV / k)); high.push(db(binH / k)); low.push(db(binL / k));
      burst.push(binBursts / (k * 0.05)); // rafales par seconde
      binE = 0; binSubs = 0; binFlux = 0; binCount = 0; binPeak = 0; binV = 0; binH = 0; binL = 0; binBursts = 0;
    }
    function sample(v) {
      const vv = fVlp(fVhp(v)), hh = fHi(v), ll = fLo(v);
      subSum += v * v; sV += vv * vv; sH += hh * hh; sL += ll * ll; subCount++; binCount++;
      if (subCount >= sub) closeSub();
      if (binCount >= perBin) { if (subCount) closeSub(); closeBin(); }
    }
    return {
      push(samples) {
        if (dec === 1) { for (let i = 0; i < samples.length; i++) sample(samples[i]); return; }
        for (let i = 0; i < samples.length; i++) { dAcc += samples[i]; if (++dCnt === dec) { sample(dAcc / dec); dAcc = 0; dCnt = 0; } }
      },
      finish() {
        if (subCount) closeSub();
        if (binSubs) closeBin();
        return { audioDb, onset, peak, voice, high, low, burst, audioStep: step };
      },
    };
  }

  /** Mesure d'une image en niveaux de gris (Uint8 luminance). */
  function createFrameAccumulator() {
    const motion = [], flash = [];
    let prev = null, prevB = null;
    return {
      push(lum) {
        let sum = 0, diff = 0;
        for (let i = 0; i < lum.length; i++) {
          sum += lum[i];
          if (prev) diff += Math.abs(lum[i] - prev[i]);
        }
        const b = sum / lum.length;
        motion.push(prev ? diff / lum.length : 0);
        flash.push(prevB === null ? 0 : Math.max(0, b - prevB));
        prev = lum.slice ? lum.slice() : Array.from(lum);
        prevB = b;
      },
      finish() { if (motion.length > 1) motion[0] = motion[1]; return { motion, flash }; },
    };
  }

  return { score, pickClips, analyzeFeatures, createAudioAccumulator, createFrameAccumulator, LABELS };
});
