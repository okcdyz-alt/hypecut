// Titres, légendes et hashtags automatiques, sans service payant.
// Choix selon le type de moment détecté (son, impact, action, flash) et son intensité.
const crypto = require('crypto');

const T = {
  a: {
    type: 'drôle',
    titres: [
      'Il a pas supporté ce moment', 'Le cri de trop', 'Personne était prêt pour ça',
      'La réaction la plus folle', 'Il a perdu la tête', 'Écoute bien la fin',
      'Ce son m’a tué', 'Il pète un câble en direct',
    ],
    desc: ['Le son à fond pour celle-là 🔊', 'Ma réaction était pas prévue 😭', 'Monte le son, crois-moi 😂'],
  },
  o: {
    type: 'crash',
    titres: [
      'L’impact le plus violent', 'Ça devait pas finir comme ça', 'Le crash de l’année',
      'Il l’a pas vu venir', 'Fin de partie brutale', 'Accident en direct',
      'Le choc de trop', 'Rien ne s’est passé comme prévu',
    ],
    desc: ['Personne n’a survécu à ça 💥', 'J’ai encore mal pour lui 😵', 'Regarde jusqu’au bout 💀'],
  },
  m: {
    type: 'poursuite',
    titres: [
      'La course-poursuite la plus folle', 'Ils m’ont jamais rattrapé', 'Fuite à toute vitesse',
      'Le run le plus intense', 'Plein gaz dans Vice City', 'Impossible de m’arrêter',
      'Le moment où tout s’accélère', 'Course contre la montre',
    ],
    desc: ['Les flics ont rien pu faire 🚓💨', 'Ça va beaucoup trop vite 🏎️', 'Ils ont lâché l’affaire 😮‍💨'],
  },
  f: {
    type: 'explosion',
    titres: [
      'L’explosion de trop', 'Tout a sauté d’un coup', 'Boom en plein Vice City',
      'Le chaos total', 'Ça a explosé sans prévenir', 'Le feu d’artifice de l’année',
      'Il fallait pas toucher à ça', 'Explosion monumentale',
    ],
    desc: ['Personne s’y attendait 💥🔥', 'Les dégâts sont énormes 😳', 'Attends l’explosion à la fin 💣'],
  },
};
const T_EN = {
  a: { type: 'funny', titres: ['He did NOT see that coming', 'The scream at the end', 'Nobody was ready for this', 'Craziest reaction ever', 'He completely lost it', 'Wait for the end', 'This sound killed me', 'Full meltdown live'],
    desc: ['Turn the sound up for this one 🔊', 'Did not expect my reaction 😭', 'Sound on, trust me 😂'] },
  o: { type: 'crash', titres: ['The most brutal impact', 'This was not the plan', 'Crash of the year', 'He never saw it coming', 'Game over, instantly', 'Live crash', 'One hit too many', 'Nothing went as planned'],
    desc: ['Nobody survived that 💥', 'I still feel that one 😵', 'Watch till the end 💀'] },
  m: { type: 'chase', titres: ['The craziest chase ever', 'They never caught me', 'Full speed escape', 'Most intense run yet', 'Pedal to the metal in Vice City', 'Unstoppable', 'When everything speeds up', 'Race against time'],
    desc: ['The cops had no chance 🚓💨', 'Way too fast 🏎️', 'They gave up 😮‍💨'] },
  f: { type: 'explosion', titres: ['One explosion too many', 'Everything blew up at once', 'Boom in Vice City', 'Total chaos', 'It exploded out of nowhere', 'Fireworks of the year', 'Should not have touched that', 'Massive explosion'],
    desc: ['Nobody expected that 💥🔥', 'The damage is huge 😳', 'Wait for the explosion 💣'] },
};
const KEY = { '🔊 Pic sonore': 'a', '💥 Impact': 'o', '🏎️ Action': 'm', '⚡ Flash / explosion': 'f', '🗣️ Le streamer s’enflamme': 'a', '😱 Cri / grosse réaction': 'a', '😂 Fou rire': 'a', '💣 Explosion': 'f', '🎯 Action + réaction': 'o' };
const TAGS = { a: ['#reaction', '#funny'], o: ['#crash', '#fail'], m: ['#poursuite', '#course'], f: ['#explosion', '#chaos'] };

function pick(arr, seed, used) {
  for (let i = 0; i < arr.length; i++) {
    const v = arr[(seed + i) % arr.length];
    if (!used.has(v)) { used.add(v); return v; }
  }
  return arr[seed % arr.length];
}

/** Ajoute à chaque clip un titre, une légende, des hashtags et un potentiel estimé (1-10). */
function suggest(clips, jobId, lang) {
  const TT = lang === 'en' ? T_EN : T;
  const used = new Set();
  const base = parseInt(crypto.createHash('md5').update(String(jobId)).digest('hex').slice(0, 6), 16);
  clips.forEach((c, i) => {
    const k = KEY[c.reasons?.[0]] || 'm';
    const t = TT[k];
    const seed = base + i * 7;
    const titre = pick(t.titres, seed, used);
    c.ai = {
      titre,
      description: t.desc[(seed + i) % t.desc.length],
      hashtags: ['#GTA6', '#GTAVI', ...TAGS[k], '#gaming'],
      type: t.type,
      viralite: Math.max(3, Math.min(10, Math.round(c.hype / 10))),
      auto: true,
    };
  });
  return clips;
}

module.exports = { suggest };
