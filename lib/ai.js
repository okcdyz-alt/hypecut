// IA : titres accrocheurs, légendes et hashtags à partir d'images du moment fort (API Claude).
const fs = require('fs');

const enabled = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

function parseJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Réponse IA illisible');
  return JSON.parse(m[0]);
}

async function describeClip({ frames, reasons, hype, duration, context }) {
  if (!enabled()) return null;
  const content = [];
  for (const f of frames) {
    if (!f || !fs.existsSync(f)) continue;
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') } });
  }
  content.push({
    type: 'text',
    text: `Tu es monteur de clips gaming viraux (TikTok, YouTube Shorts, Reels). La communauté prépare la sortie de GTA VI (19 novembre 2026).
Ces images viennent d'un moment fort détecté automatiquement dans une vidéo de gameplay${context ? ` (« ${String(context).slice(0, 120)} »)` : ''} : la première juste avant le pic, la seconde au pic.
Signaux mesurés : ${reasons.join(', ')} ; intensité ${hype}/100 ; durée du clip ${Math.round(duration)} s.
Décris seulement ce que tu vois, n'invente pas d'événement.
Réponds UNIQUEMENT avec un objet JSON valide :
{"titre": "titre accrocheur en français, 42 caractères max, sans hashtag ni emoji",
 "description": "une phrase de légende pour le post, peut contenir 1 emoji",
 "hashtags": ["#GTA6", "4 autres hashtags pertinents"],
 "type": "un mot parmi : poursuite, fusillade, crash, cascade, explosion, braquage, drôle, paysage, cinématique, autre",
 "viralite": entier de 1 à 10}`,
  });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(60e3),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`IA : ${j.error?.message || res.status}`);
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = parseJson(text);
  return {
    titre: String(out.titre || '').slice(0, 60),
    description: String(out.description || '').slice(0, 220),
    hashtags: (Array.isArray(out.hashtags) ? out.hashtags : []).map(String).slice(0, 6),
    type: String(out.type || 'autre'),
    viralite: Math.max(1, Math.min(10, parseInt(out.viralite, 10) || 5)),
  };
}

module.exports = { enabled, describeClip, MODEL };
