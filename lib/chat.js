// Chat des VOD Twitch : on lit les messages autour de chaque moment candidat et on les compare
// au rythme habituel du chat. Un chat qui s'emballe (ou spamme KEKW / « clip ») est le meilleur
// indice qu'un moment a vraiment plu au public. Tout est facultatif : si Twitch refuse, on s'en passe.
const GQL = 'https://gql.twitch.tv/gql';
const CLIENT_IDS = (process.env.TWITCH_GQL_CLIENT_ID || 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp,kimne78kx3ncx6brgo4mv6wki5h1ko').split(',');
const HASH = process.env.TWITCH_COMMENTS_HASH || 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a';

// Réactions typiques dans le chat (emotes et texte) — insensible à la casse
const HYPE_RE = /\b(kekw|lulw?|omegalul|icant|pog(champ|gers|u)?|monka[sw]|pepelaugh|xd+|mdr+|ptdr+|lol+|wtf+|clip+|clipp?(ez|e)|gg+|w+|insane|no ?way|jpp|ahah+|haha+|\+1)\b|😂|🤣|💀|🔥|😱/i;

function vodId(url) {
  const m = String(url || '').match(/twitch\.tv\/(?:[^/]+\/)?(?:videos|v)\/(\d+)/i);
  return m ? m[1] : null;
}

let workingClient = null;
async function page(id, { offset, cursor }) {
  const ids = workingClient ? [workingClient] : CLIENT_IDS;
  let lastErr;
  for (const cid of ids) {
    try {
      const res = await fetch(GQL, {
        method: 'POST',
        headers: { 'Client-Id': cid, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify([{
          operationName: 'VideoCommentsByOffsetOrCursor',
          variables: cursor ? { videoID: id, cursor } : { videoID: id, contentOffsetSeconds: Math.max(0, Math.floor(offset)) },
          extensions: { persistedQuery: { version: 1, sha256Hash: HASH } },
        }]),
        signal: AbortSignal.timeout(7000),
      });
      const j = await res.json();
      const c = j?.[0]?.data?.video?.comments;
      if (!res.ok || !c) throw new Error(j?.[0]?.errors?.[0]?.message || `HTTP ${res.status}`);
      workingClient = cid;
      return {
        msgs: (c.edges || []).map((e) => ({
          t: e.node?.contentOffsetSeconds ?? 0,
          text: (e.node?.message?.fragments || []).map((f) => f.text || '').join(''),
        })),
        cursor: c.edges?.length ? c.edges[c.edges.length - 1].cursor : null,
        more: !!c.pageInfo?.hasNextPage,
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('chat indisponible');
}

/** Messages entre a et b (secondes dans la VOD), au plus `maxPages` pages. */
async function messagesBetween(id, a, b, maxPages = 6) {
  const out = [];
  let p = await page(id, { offset: a });
  for (let i = 0; i < maxPages; i++) {
    for (const m of p.msgs) if (m.t >= a && m.t <= b) out.push(m);
    const last = p.msgs.length ? p.msgs[p.msgs.length - 1].t : b + 1;
    if (!p.more || !p.cursor || last > b) break;
    p = await page(id, { cursor: p.cursor });
  }
  return out;
}

/** Rythme du chat (messages / s) estimé à partir d'une page commençant à `offset`. */
async function rateAt(id, offset) {
  const p = await page(id, { offset });
  const ms = p.msgs.filter((m) => m.t >= offset);
  if (ms.length < 2) return 0;
  const span = Math.max(5, ms[ms.length - 1].t - offset);
  return ms.length / span;
}

/**
 * Pour chaque candidat { peak } (temps dans le fichier analysé), mesure le chat dans les 25 s qui suivent le pic
 * (le chat réagit avec 2 à 15 s de retard). `offset` = position du fichier dans la VOD.
 * Renvoie null si le chat n'est pas lisible, sinon [{ rate, base, ratio, hypeFrac, n, top }].
 */
async function measure(url, candidates, { offset = 0, duration, budgetMs = 30e3 } = {}) {
  const id = vodId(url);
  if (!id || !candidates.length) return null;
  const t0 = Date.now();
  const late = () => Date.now() - t0 > budgetMs;
  try {
    // rythme habituel : quelques sondages répartis sur la vidéo
    const probes = [];
    for (let k = 0; k < 6; k++) probes.push(offset + (duration || 3600) * (k + 0.5) / 6);
    const rates = [];
    for (const o of probes) { if (late()) break; rates.push(await rateAt(id, o).catch(() => null)); }
    const ok = rates.filter((r) => r !== null).sort((a, b) => a - b);
    if (!ok.length) return null;
    const base = Math.max(0.05, ok[Math.floor(ok.length / 2)]);
    const out = [];
    for (const c of candidates) {
      if (late()) { out.push(null); continue; }
      const a = offset + c.peak - 3, b = offset + c.peak + 25;
      const ms = await messagesBetween(id, a, b).catch(() => null);
      if (!ms) { out.push(null); continue; }
      const rate = ms.length / (b - a);
      const hype = ms.filter((m) => HYPE_RE.test(m.text));
      // mots les plus répétés dans le chat (pour l'étiquette du clip)
      const freq = {};
      for (const m of hype) { const w = (m.text.match(HYPE_RE) || [''])[0].toUpperCase(); if (w) freq[w] = (freq[w] || 0) + 1; }
      const top = Object.entries(freq).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
      out.push({ rate: +rate.toFixed(3), base: +base.toFixed(3), ratio: +(rate / base).toFixed(2), hypeFrac: ms.length ? +(hype.length / ms.length).toFixed(2) : 0, n: ms.length, top });
    }
    return out;
  } catch (e) {
    console.warn('[chat]', e.message);
    return null;
  }
}

module.exports = { measure, vodId, HYPE_RE };
