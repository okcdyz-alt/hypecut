/* HYPECUT — détection des moments forts (partagé navigateur + serveur).
 * Entrée : séries de mesures échantillonnées tous les `step` secondes
 *   audioDb  : volume moyen (dB) par tranche          (null si pas de son)
 *   onset    : « attaques » sonores (hausses brusques) (null si pas de son)
 *   motion   : différence d'image moyenne (mouvement / changement de plan)
 *   flash    : hausse brutale de luminosité (explosions, flashs)
 * Sortie : courbe d'intensité 0-100 + liste de clips proposés.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HypeScoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WEIGHTS = {
    balanced: { a: 0.35, o: 0.25, m: 0.30, f: 0.10 },
    audio:    { a: 0.50, o: 0.35, m: 0.10, f: 0.05 },
    action:   { a: 0.15, o: 0.15, m: 0.55, f: 0.15 },
  };
  const LABELS = {
    a: '🔊 Pic sonore',
    o: '💥 Impact',
    m: '🏎️ Action',
    f: '⚡ Flash / explosion',
  };

  function zscore(arr) {
    const n = arr.length || 1;
    let mean = 0;
    for (const v of arr) mean += v;
    mean /= n;
    let sd = 0;
    for (const v of arr) sd += (v - mean) * (v - mean);
    sd = Math.sqrt(sd / n) || 1;
    return arr.map((v) => Math.max(-3, Math.min(4, (v - mean) / sd)));
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

  function score(feats, step, priority) {
    const n = feats.motion.length;
    const zeros = new Array(n).fill(0);
    const hasAudio = !!(feats.audioDb && feats.audioDb.length);
    const fit = (a) => { const o = (a || []).slice(0, n); while (o.length < n) o.push(o.length ? o[o.length - 1] : 0); return o; };
    const A = hasAudio ? zscore(fit(feats.audioDb)) : zeros;
    const O = hasAudio ? zscore(fit(feats.onset)) : zeros;
    const M = zscore(fit(feats.motion));
    const F = zscore(fit(feats.flash));
    const w = Object.assign({}, WEIGHTS[priority] || WEIGHTS.balanced);
    if (!hasAudio) { w.m += w.a * 0.7 + w.o * 0.7; w.f += (w.a + w.o) * 0.3; w.a = 0; w.o = 0; }
    const raw = new Array(n);
    for (let i = 0; i < n; i++) raw[i] = w.a * A[i] + w.o * O[i] + w.m * M[i] + w.f * F[i];
    const sm = smooth(raw, 1.5 / step);
    const sorted = sm.slice().sort((x, y) => x - y);
    const lo = sorted[Math.floor(0.1 * (n - 1))] ?? 0;
    const hi = sorted[Math.floor(0.995 * (n - 1))] ?? 1;
    const series = sm.map((v) => Math.round(Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1))) * 100));
    return { series, comps: { a: A, o: O, m: M, f: F }, w };
  }

  function reasonsAt(i, comps, w) {
    const parts = [];
    for (const key of ['a', 'o', 'm', 'f']) {
      let s = 0, c = 0;
      for (let j = i - 2; j <= i + 2; j++) { if (comps[key][j] === undefined) continue; s += comps[key][j]; c++; }
      parts.push({ key, v: w[key] * (c ? s / c : 0) });
    }
    parts.sort((x, y) => y.v - x.v);
    const out = parts.filter((p) => p.v > 0.15).slice(0, 2).map((p) => LABELS[p.key]);
    return out.length ? out : ['🔥 Moment fort'];
  }

  /** Choisit les meilleurs moments sans chevauchement. */
  function pickClips(scored, step, duration, clipLen, count) {
    const { series, comps, w } = scored;
    const n = series.length;
    if (!n) return [];
    if (duration <= clipLen + 1) {
      let best = 0;
      for (let i = 1; i < n; i++) if (series[i] > series[best]) best = i;
      return [{ start: 0, end: duration, peak: (best + 0.5) * step, hype: series[best], reasons: reasonsAt(best, comps, w) }];
    }
    const order = series.map((_, i) => i).sort((x, y) => series[y] - series[x]);
    const clips = [];
    for (const i of order) {
      const t = (i + 0.5) * step;
      if (clips.length && series[i] < 20) break; // le reste est trop plat pour faire un bon clip
      if (clips.some((c) => Math.abs(c.peak - t) < clipLen * 0.8)) continue;
      const start = Math.max(0, Math.min(duration - clipLen, t - clipLen * 0.6));
      clips.push({
        start: +start.toFixed(2),
        end: +(start + clipLen).toFixed(2),
        peak: +t.toFixed(2),
        hype: series[i],
        reasons: reasonsAt(i, comps, w),
      });
      if (clips.length >= count) break;
    }
    return clips;
  }

  function analyzeFeatures(feats, opts) {
    const scored = score(feats, opts.step, opts.priority);
    const clips = pickClips(scored, opts.step, opts.duration, opts.clipLen, opts.count);
    return { series: scored.series, clips };
  }

  /** Accumulateur audio : reçoit des échantillons mono, produit volume (dB) et attaques par tranche. */
  function createAudioAccumulator(sampleRate, step) {
    const sub = Math.max(1, Math.round(sampleRate * 0.05));
    const perBin = Math.max(1, Math.round(sampleRate * step));
    const audioDb = [], onset = [];
    let subSum = 0, subCount = 0, binCount = 0, prevE = 0;
    let binE = 0, binSubs = 0, binFlux = 0;
    function closeSub() {
      const e = Math.sqrt(subSum / (subCount || 1));
      binFlux += Math.max(0, e - prevE);
      prevE = e;
      binE += e; binSubs++;
      subSum = 0; subCount = 0;
    }
    function closeBin() {
      const e = binE / (binSubs || 1);
      audioDb.push(20 * Math.log10(e + 1e-5));
      onset.push(binFlux);
      binE = 0; binSubs = 0; binFlux = 0; binCount = 0;
    }
    return {
      push(samples) {
        for (let i = 0; i < samples.length; i++) {
          const v = samples[i];
          subSum += v * v; subCount++; binCount++;
          if (subCount >= sub) closeSub();
          if (binCount >= perBin) { if (subCount) closeSub(); closeBin(); }
        }
      },
      finish() {
        if (subCount) closeSub();
        if (binSubs) closeBin();
        return { audioDb, onset };
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
