// Deuxième passe de sélection des clips.
// La première passe (public/scoring.js) repère des moments « forts » au son et à l'image. Mais fort ≠ intéressant :
// un remerciement d'abonnement crié, une musique, une pub ou une discussion banale peuvent faire du bruit.
// Ici on vérifie chaque candidat avec ce que les signaux bruts ne voient pas :
//   1. CE QUI EST DIT (transcription autour du pic) : vraie réaction, contexte avant le pic, ou discours « administratif » ;
//   2. LE CHAT Twitch : le public s'est-il emballé juste après ?
//   3. L'IA (si configurée) : regard de monteur sur les images + le texte ;
// puis on recale le début et la fin sur des phrases entières et on garde les meilleurs.
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------ analyse du texte (pure, testable)
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Réactions (FR + EN, vocabulaire de stream). Poids : 1 = réaction forte, 0.5 = moyenne.
const REACT = [
  [1, /\b(c'?est pas possible|pas possible|j'?y crois pas|je suis mort|jsuis mort|chui mort|je meurs|oh mon dieu|mon dieu|no way|oh my god|omg|what the|let'?s go|mais non|mais quoi|c'?est quoi ce|t'?es serieux|incroyable|de ouf|de fou|dingue|insane|holy|wtf|putain|bordel|oh la la|ohlala|clippez|clip (ca|ça|ce)|il faut clip|mdr|ptdr|jpp|jamais de la vie|nan mais|aide moi|au secours|c'?est fini|je rage|je craque)\b/],
  [0.5, /\b(non|quoi|what|wow|waouh|attends|attendez|regarde|regardez|vas y|allez|go|yes|ouais|bah non|serieux|frero|frerot|bro|wesh|oh|ah|eh)\b/],
];
const LAUGH = /\b(a?ha(ha)+h?|he(he)+|hi(hi)+|x+d+|mdr+|ptdr+|lol+)\b/;
// Discours qui fait du bruit sans être un bon clip : remerciements, pub, organisation du live
const ADMIN = [
  [1, /\b(merci (beaucoup )?(pour|a) (le|les|ton|ta|tes) (sub|subs|abonnement|abo|follow|dons?|bits|prime|resub|raid)|abonnez vous|abonne toi|code promo|sponsoris|partenariat|lien en description|je reviens|je vais revenir|pause pipi|petite pause|afk|brb|fin du live|on se retrouve demain|bonne nuit (a tous|le chat)|bienvenue (a|aux) )/],
  [0.5, /\b(merci|abonnement|abonnes?|sub|subs|follow|bits|dons?|donation|prime|raid|pub|publicite|sponsor|giveaway|concours|le chat|dans le chat|salut a tous|salut tout le monde)\b/],
];

/** Mesures du texte d'un candidat. words : [{w,s,e}] en temps absolus. */
function textFeatures(words, { start, end, peak }) {
  const L = end - start;
  const inClip = words.filter((w) => w.s >= start - 0.2 && w.e <= end + 0.2);
  const near = words.filter((w) => w.s >= peak - 6 && w.s <= peak + 8);
  const before = words.filter((w) => w.s >= start && w.s < peak - 1.5);
  const txt = (ws) => norm(ws.map((w) => w.w).join(' '));
  const nearT = ` ${txt(near)} `, allT = ` ${txt(inClip)} `;
  const count = (re, t) => (t.match(new RegExp(re.source, 'g')) || []).length;
  let react = 0, quote = null;
  for (const [wgt, re] of REACT) {
    const n = count(re, nearT);
    react += wgt * n;
    if (!quote && wgt === 1 && n) quote = (nearT.match(re) || [null])[0]?.trim() || null;
  }
  const laughs = count(LAUGH, nearT);
  // répétitions (« non non non », « oh oh oh ») : signe d'excitation
  const toks = txt(near).split(' ');
  let rep = 0;
  for (let i = 2; i < toks.length; i++) if (toks[i] && toks[i] === toks[i - 1] && toks[i] === toks[i - 2]) rep++;
  let admin = 0;
  for (const [wgt, re] of ADMIN) admin += wgt * count(re, allT);
  const cover = inClip.reduce((s, w) => s + Math.max(0, w.e - w.s), 0) / (L || 1);
  // débit : la voix accélère-t-elle autour du pic ?
  const rateNear = near.length / 14, rateAll = inClip.length / (L || 1);
  const rateUp = rateAll > 0 ? Math.min(2, rateNear / rateAll) : 0;
  const setup = Math.min(1, before.length / 6); // un peu de contexte avant le moment
  const reactScore = Math.min(1, (react + laughs * 0.8 + rep * 0.5) / 2.5);
  const adminScore = Math.min(1, admin / 2);
  let score;
  if (cover < 0.05) score = 0.35; // personne ne parle : clip de pur gameplay, ni bonus ni malus
  else score = 0.5 * reactScore + 0.2 * Math.min(1, cover / 0.35) + 0.15 * setup + 0.15 * Math.max(0, rateUp - 1);
  score = Math.max(0, score - 0.6 * adminScore);
  return { score: +score.toFixed(3), react: +reactScore.toFixed(2), admin: +adminScore.toFixed(2), cover: +cover.toFixed(2), setup: +setup.toFixed(2), laughs, quote, text: inClip.map((w) => w.w).join(' ') };
}

/** Recale début / fin sur des pauses entre phrases, sans perdre le pic. Longueur gardée à ±3 s de L. */
function snapToSpeech(words, { start, end, peak }, duration) {
  if (!words.length) return { start, end };
  const L = end - start;
  const gaps = []; // instants où l'on peut couper : avant le premier mot d'une phrase / après le dernier
  for (let i = 0; i < words.length; i++) {
    const prevE = i ? words[i - 1].e : -Infinity, nextS = i + 1 < words.length ? words[i + 1].s : Infinity;
    if (words[i].s - prevE >= 0.35 || /[.!?…]$/.test(words[i - 1]?.w || '')) gaps.push({ t: Math.max(0, words[i].s - 0.15), kind: 's' });
    if (nextS - words[i].e >= 0.35 || /[.!?…]$/.test(words[i].w)) gaps.push({ t: words[i].e + 0.25, kind: 'e' });
  }
  // couper en plein mot est le pire : on vérifie qu'un instant ne tombe pas dans un mot
  const inWord = (t) => words.some((w) => t > w.s + 0.05 && t < w.e - 0.05);
  let s = start, e = end;
  const sC = gaps.filter((g) => g.kind === 's' && Math.abs(g.t - start) <= 4 && peak - g.t >= L * 0.25 && peak - g.t <= L * 0.75);
  if (sC.length) s = sC.sort((a, b) => Math.abs(a.t - start) - Math.abs(b.t - start))[0].t;
  else if (inWord(s)) { const w = words.find((x) => s > x.s && s < x.e); if (w) s = w.s - 0.1; }
  const eC = gaps.filter((g) => g.kind === 'e' && g.t - s >= L - 3 && g.t - s <= L + 3 && g.t > peak + 1.5);
  if (eC.length) e = eC.sort((a, b) => Math.abs(a.t - (s + L)) - Math.abs(b.t - (s + L)))[0].t;
  else { e = s + L; if (inWord(e)) { const w = words.find((x) => e > x.s && e < x.e); if (w) e = w.e + 0.2; } }
  s = Math.max(0, s); e = Math.min(duration, e);
  return { start: +s.toFixed(2), end: +e.toFixed(2) };
}

/** Combine les notes disponibles (chacune 0-1) avec des poids renormalisés. */
function combine(parts) {
  const W = { signal: 0.4, speech: 0.3, chat: 0.25, ai: 0.3 };
  let s = 0, w = 0;
  for (const k of Object.keys(W)) if (parts[k] !== null && parts[k] !== undefined) { s += W[k] * parts[k]; w += W[k]; }
  return w ? s / w : 0;
}

function chatScore(c) {
  if (!c) return null;
  if (c.n < 3 && c.base < 0.2) return null; // chat trop calme pour dire quoi que ce soit
  const burst = Math.max(0, Math.min(1, Math.log2(Math.max(c.ratio, 0.01)) / 2)); // ×4 le rythme habituel = 1
  return +(0.7 * burst + 0.3 * Math.min(1, c.hypeFrac / 0.4)).toFixed(3);
}

/**
 * Note finale et sélection. pool : candidats de la 1re passe [{start,end,peak,hype,reasons,_v}].
 * extra[i] : { words, text: textFeatures, chat, ai }.
 */
function select(pool, extra, count, duration) {
  if (!pool.length) return [];
  const vMax = Math.max(...pool.map((c) => c._v || 0), 1e-6);
  const rows = pool.map((c, i) => {
    const x = extra[i] || {};
    const parts = {
      signal: (c._v || 0) / vMax,
      speech: x.text ? x.text.score : null,
      chat: chatScore(x.chat),
      ai: x.ai ? (x.ai.note - 1) / 9 : null,
    };
    let f = combine(parts);
    if (x.text && x.text.admin >= 0.75) f *= 0.45; // remerciements / pub / pause : quasi éliminé
    if (x.ai && !x.ai.garder) f *= 0.6;
    const reasons = [];
    if (parts.chat !== null && parts.chat >= 0.55) reasons.push(x.chat.top ? `💬 Le chat s’enflamme (${x.chat.top})` : '💬 Le chat s’enflamme');
    if (x.text && x.text.quote && x.text.react >= 0.4) reasons.push(`🗣️ « ${x.text.quote} »`);
    else if (x.text && x.text.laughs >= 2) reasons.push('😂 Fou rire');
    for (const r of c.reasons || []) if (reasons.length < 3 && !reasons.includes(r)) reasons.push(r);
    if (x.ai && x.ai.garder && x.ai.pourquoi && reasons.length < 3) reasons.push(`✅ ${x.ai.pourquoi}`);
    const b = x.words ? snapToSpeech(x.words, c, duration) : { start: c.start, end: c.end };
    return {
      start: b.start, end: b.end, peak: c.peak,
      hype: Math.round(Math.max(c.hype * 0.5 + f * 50, Math.min(100, f * 100))),
      reasons: reasons.slice(0, 3),
      why: x.ai?.pourquoi || undefined,
      _f: f, _parts: parts,
    };
  }).sort((a, b) => b._f - a._f);
  const out = [];
  const best = rows[0]._f;
  for (const r of rows) {
    if (out.length >= count) break;
    if (out.some((c) => r.start < c.end + 1 && r.end > c.start - 1)) continue;
    if (out.length >= 1 && r._f < best * 0.5) continue; // mieux vaut moins de clips que des clips inutiles
    out.push(r);
  }
  for (const r of out) { console.log('[sélection]', r.start, r._f.toFixed(2), JSON.stringify(r._parts)); delete r._f; delete r._parts; if (!r.why) delete r.why; }
  return out;
}

// ------------------------------------------------------------------ orchestration (serveur)
/**
 * ctx : { run, FFMPEG, tmpDir, sourceUrl, offset, lang, aiEnabled, context, say(msg, p) }
 */
async function rerank(file, info, pool, count, ctx) {
  const say = ctx.say || (() => {});
  const extra = pool.map(() => ({}));
  const PY = process.env.PYTHON_PATH || 'python3';
  const SCRIPT = path.join(__dirname, 'transcribe.py');

  // 1) Ce qui est dit — fenêtres autour des pics, dans un budget de temps d'écoute (le serveur est modeste)
  if (info.hasAudio && process.env.RERANK_SPEECH !== '0') {
    const budget = +process.env.RERANK_SPEECH_BUDGET_SEC || 150;
    const wins = [];
    let used = 0;
    const order = pool.map((c, i) => i).sort((a, b) => (pool[b]._v || 0) - (pool[a]._v || 0));
    for (const i of order) {
      const c = pool[i];
      // zone utile : le contexte avant le pic et la réaction après (le serveur est modeste, on n'écoute pas tout)
      const a = Math.max(0, c.peak - 12), b = Math.min(info.duration, c.peak + 8);
      if (used + (b - a) > budget && wins.length >= 3) continue;
      wins.push({ i, a, b, wav: path.join(ctx.tmpDir, `cand_${i}.wav`) }); used += b - a;
    }
    try {
      say('Écoute de ce qui est dit…', 0);
      for (const w of wins) await ctx.run(ctx.FFMPEG, ['-v', 'error', '-y', '-ss', w.a.toFixed(2), '-t', (w.b - w.a).toFixed(2), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', w.wav], { timeoutMs: 120e3 });
      let outTxt = '', done = 0;
      await ctx.run(PY, [SCRIPT, ...(ctx.lang ? [`--lang=${ctx.lang}`] : []), ...wins.map((w) => w.wav)], {
        onStdout: (d) => { outTxt += d; const n = outTxt.split('\n').filter(Boolean).length; if (n !== done) { done = n; say('Écoute de ce qui est dit…', n / wins.length); } },
        timeoutMs: +process.env.RERANK_WHISPER_TIMEOUT_MS || Math.max(4 * 60e3, used * 1500),
      });
      const lines = outTxt.split('\n').filter((l) => l.trim().startsWith('{'));
      wins.forEach((w, k) => {
        const j = lines[k] ? JSON.parse(lines[k]) : null;
        if (!j) return;
        const words = (j.words || []).map((x) => ({ w: x.w, s: +(x.s + w.a).toFixed(2), e: +(x.e + w.a).toFixed(2) }));
        extra[w.i].words = words;
        extra[w.i].text = textFeatures(words, pool[w.i]);
      });
    } catch (e) {
      console.warn('[sélection] transcription indisponible :', e.message.slice(0, 200));
    } finally {
      for (const w of wins) fs.rm(w.wav, { force: true }, () => {});
    }
  }

  // 2) Le chat (VOD Twitch uniquement)
  if (ctx.sourceUrl && process.env.RERANK_CHAT !== '0') {
    say('Lecture du chat…', 0);
    const chat = await require('./chat').measure(ctx.sourceUrl, pool, { offset: ctx.offset || 0, duration: info.duration }).catch(() => null);
    if (chat) chat.forEach((c, i) => { extra[i].chat = c; });
    console.log('[sélection] chat', chat ? `${chat.filter(Boolean).length}/${pool.length} candidats mesurés` : 'indisponible');
  }

  // 3) Regard de monteur (IA), sur les meilleurs candidats seulement
  if (ctx.aiEnabled) {
    const ai = require('./ai');
    const pre = pool.map((c, i) => ({ i, f: combine({ signal: (c._v || 0) / Math.max(...pool.map((p) => p._v || 0), 1e-6), speech: extra[i].text?.score ?? null, chat: chatScore(extra[i].chat) }) }))
      .sort((a, b) => b.f - a.f).slice(0, Math.min(pool.length, +process.env.RERANK_AI_MAX || Math.max(count + 3, 6)));
    const { thumbnail } = require('./media');
    for (let k = 0; k < pre.length; k++) {
      const i = pre[k].i, c = pool[i];
      say('L’IA vérifie chaque moment…', k / pre.length);
      const fr = [c.start + (c.peak - c.start) * 0.4, c.peak, Math.min(c.end - 0.5, c.peak + 3)].map((t, j) => ({ t, f: path.join(ctx.tmpDir, `rk_${i}_${j}.jpg`) }));
      try {
        for (const x of fr) await thumbnail(file, x.t, x.f, 512);
        const ch = extra[i].chat;
        extra[i].ai = await ai.rateClip({
          frames: fr.map((x) => x.f), transcript: extra[i].text?.text || '', reasons: c.reasons || [], duration: c.end - c.start, context: ctx.context,
          chat: ch ? `${ch.n} messages en 28 s (${ch.ratio}× le rythme habituel)${ch.top ? `, surtout « ${ch.top} »` : ''}` : null,
        });
      } catch (e) { console.warn('[sélection] IA :', e.message.slice(0, 160)); }
      finally { for (const x of fr) fs.rm(x.f, { force: true }, () => {}); }
    }
  }

  return select(pool, extra, count, info.duration);
}

module.exports = { rerank, textFeatures, snapToSpeech, select, chatScore, norm };
