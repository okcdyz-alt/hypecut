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


/**
 * Note un moment candidat comme le ferait un monteur : est-ce que ce passage, seul, donne envie de regarder
 * jusqu'au bout ? Images (avant / pic / après) + ce qui est dit + réaction du chat.
 */
async function rateClip({ frames, transcript, chat, reasons, duration, context }) {
  if (!enabled()) return null;
  const content = [];
  for (const f of frames) {
    if (!f || !fs.existsSync(f)) continue;
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') } });
  }
  content.push({
    type: 'text',
    text: `Tu es un monteur expérimenté de clips de streamers (TikTok, Shorts). On hésite à garder ce passage de ${Math.round(duration)} s${context ? ` (vidéo : « ${String(context).slice(0, 120)} »)` : ''}.
Images : avant le moment, au moment, juste après.
Ce qui est dit : ${transcript ? `« ${String(transcript).slice(0, 700)} »` : '(rien de compréhensible)'}
Chat : ${chat || 'inconnu'}
Signaux sonores et visuels : ${reasons.join(', ')}.
Un bon clip se comprend seul, a un déclencheur clair (action, phrase, surprise) et une réaction ou une chute.
Un mauvais clip : remerciements d'abonnements ou de dons, pub, pause, menu, discussion banale, bruit sans raison, musique seule.
Ne suppose rien que tu ne vois ou n'entends pas.
Réponds UNIQUEMENT avec un objet JSON : {"note": entier 1-10, "garder": true/false, "pourquoi": "8 mots max, en français"}`,
  });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 150, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(45e3),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`IA : ${j.error?.message || res.status}`);
  const out = parseJson((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
  return { note: Math.max(1, Math.min(10, parseInt(out.note, 10) || 5)), garder: out.garder !== false, pourquoi: String(out.pourquoi || '').slice(0, 80) };
}

module.exports = { enabled, describeClip, rateClip, MODEL };
