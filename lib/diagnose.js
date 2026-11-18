// Messages d'échec : on cible la cause quand on la reconnaît, sinon on liste toutes les causes possibles.
const userError = (msg) => Object.assign(new Error(msg), { user: true });

const fmtDur = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? (m % 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m / 60} h`) : `${m} min`;
};
const clock = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, x = sec % 60; return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };
const NAMES = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube' };

/** Nature d'un lien Twitch ou Kick : vod, clip, channel (chaîne ou live), list (page de liste) ou unknown. */
function linkKind(src) {
  let u;
  try { u = new URL(src.url); } catch { return 'unknown'; }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const p = u.pathname.replace(/\/+$/, '') || '/';
  if (src.platform === 'twitch') {
    if (host === 'clips.twitch.tv') return 'clip';
    if (/^\/videos\/\d+$/.test(p) || /^\/[\w]+\/v(ideo)?\/\d+$/.test(p)) return 'vod';
    if (/^\/[\w]+\/clip\/[\w-]+$/.test(p) || /^\/clip\/[\w-]+$/.test(p)) return 'clip';
    if (/^\/[\w]+\/(videos|clips|schedule|about)$/.test(p) || /^\/collections\//.test(p)) return 'list';
    if (/^\/[\w]+$/.test(p) && !u.searchParams.get('clip')) return 'channel';
    return 'unknown';
  }
  if (src.platform === 'kick') {
    if (/^\/([\w-]+\/)?videos?\/[\w-]+$/.test(p)) return 'vod';
    if (/^\/[\w-]+\/clips\/[\w-]+$/.test(p) || u.searchParams.get('clip')) return 'clip';
    if (/^\/[\w-]+\/(videos|clips|about)$/.test(p)) return 'list';
    if (/^\/[\w-]+$/.test(p)) return 'channel';
  }
  return 'unknown';
}

const HOW_TO_VOD = {
  twitch: 'Ouvre la chaîne sur Twitch, va dans l’onglet « Vidéos », ouvre la VOD voulue et copie son lien (il ressemble à twitch.tv/videos/123456789). Un clip Twitch marche aussi.',
  kick: 'Ouvre la chaîne sur Kick, va dans l’onglet « Videos », ouvre la VOD voulue et copie son lien (il contient /videos/). Un clip Kick marche aussi.',
};

/** Refuse tout de suite les liens qui ne peuvent pas marcher (chaîne, page de liste). */
function assertUsableLink(src) {
  const k = linkKind(src);
  const name = NAMES[src.platform] || 'ce site';
  if (k === 'channel') throw userError(`C’est le lien d’une chaîne ${name}, pas d’une vidéo : on ne peut pas découper un live, ni deviner quelle VOD tu veux.\n${HOW_TO_VOD[src.platform]}`);
  if (k === 'list') throw userError(`C’est le lien d’une page de liste ${name}, pas d’une vidéo précise.\n${HOW_TO_VOD[src.platform]}`);
  return k;
}

/** VOD trop longue pour l'offre : message avec les solutions. */
function tooLong(durationSec, plan, platform) {
  const max = fmtDur(plan.maxDurationMin * 60);
  const fixes = [`choisis le passage à analyser (champs « Début » et « Fin », ${max} max)`];
  if (platform === 'twitch') fixes.push(`colle le lien d’un clip ou d’un temps fort (Highlight) Twitch de moins de ${max}`);
  else if (platform === 'kick') fixes.push('colle plutôt le lien d’un clip Kick');
  if (plan.maxDurationMin < 240) fixes.push('passe à l’offre Pro : vidéos jusqu’à 4 h');
  else if (plan.maxDurationMin < 480) fixes.push('passe à l’offre Créateur : VOD jusqu’à 8 h');
  const lines = fixes.map((f, i) => `• ${i ? 'ou ' : ''}${f}${i === fixes.length - 1 ? '.' : ' ;'}`);
  return userError([`Cette vidéo dure ${fmtDur(durationSec)} : ton offre accepte jusqu’à ${max}.`, 'Solutions :', ...lines].join('\n'));
}

/** Échec de récupération Twitch / Kick : cause précise si on la reconnaît, sinon toutes les causes possibles. */
function platformFailure(err, platform) {
  const m = String(err && err.message || err);
  const name = NAMES[platform] || 'la plateforme';
  console.warn('[source]', platform, m.slice(-600));
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(m)) return userError(`${name} bloque temporairement les téléchargements depuis nos serveurs. Réessaie dans quelques minutes, ou importe ton fichier.`);
  if (/is offline|not currently live|is_live|live event|currently live/i.test(m)) return userError(`Ce lien pointe vers un live ou une chaîne, pas vers une VOD : on ne peut découper qu’une vidéo terminée.\n${HOW_TO_VOD[platform] || ''}`.trim());
  if (/subscri|sub-only|sub only|only available to|restricted|abonn/i.test(m)) return userError(`Cette VOD est réservée aux abonnés de la chaîne : nos serveurs ne peuvent pas y accéder.\nSi c’est ta chaîne, rends la VOD publique dans les paramètres ${name}, ou télécharge-la et importe le fichier.`);
  if (/Private video|This video is private|members-only/i.test(m)) return userError('Cette vidéo est privée : nos serveurs ne peuvent pas y accéder. Rends-la publique, ou télécharge-la et importe le fichier.');
  if (/does not exist|has been deleted|Video unavailable|not found|HTTP Error 404|404:/i.test(m)) return userError(`Vidéo introuvable : elle a été supprimée, elle a expiré (${platform === 'twitch' ? 'Twitch efface les VOD au bout de 7 à 60 jours selon la chaîne' : 'les VOD ne sont gardées qu’un temps limité'}) ou le lien est incomplet.\nOuvre le lien dans ton navigateur pour vérifier qu’il marche.`);
  if (/not available in your country|geo.?restrict|not available in your region/i.test(m)) return userError('Cette vidéo n’est pas disponible dans le pays de nos serveurs. Télécharge-la et importe le fichier.');
  if (/age.?restrict|mature content|Login required|requires? (a )?log ?in|Sign in to view|use --cookies/i.test(m)) return userError(`Cette vidéo demande d’être connecté (contenu réservé aux adultes ou protégé) : nos serveurs ne peuvent pas y accéder. Télécharge-la et importe le fichier.`);
  if (/HTTP Error 429|Too Many Requests|rate.?limit/i.test(m)) return userError(`${name} limite temporairement nos téléchargements. Réessaie dans quelques minutes.`);
  if (/HTTP Error 403|Forbidden|Cloudflare|blocked/i.test(m)) return userError(`${name} a refusé l’accès à cette vidéo. Causes possibles :\n• la VOD est réservée aux abonnés ou privée ;\n• ${name} bloque temporairement nos serveurs (réessaie dans quelques minutes).\nSi ça continue, télécharge la vidéo et importe le fichier.`);
  if (/timed? ?out|Connection reset|ECONNRESET|Read timed out|IncompleteRead|SIGKILL/i.test(m)) return userError(`La récupération depuis ${name} a été coupée en route (connexion interrompue ou trop lente). Réessaie : ça passe souvent au deuxième essai. Pour une très longue VOD, utilise plutôt un clip ou un temps fort.`);
  if (/Unsupported URL/i.test(m)) return userError(`Ce lien n’est pas reconnu. Colle le lien d’une VOD ou d’un clip ${name}.\n${HOW_TO_VOD[platform] || ''}`.trim());
  return userError([
    `On n’a pas pu récupérer cette vidéo depuis ${name}. Causes possibles :`,
    '• le lien est celui d’une chaîne ou d’un live, pas d’une VOD ou d’un clip ;',
    '• la VOD est réservée aux abonnés, privée ou supprimée ;',
    `• la VOD a expiré (${platform === 'twitch' ? 'Twitch les efface au bout de 7 à 60 jours' : 'elles ne sont gardées qu’un temps limité'}) ;`,
    `• ${name} bloque temporairement nos serveurs.`,
    'Vérifie que le lien s’ouvre bien dans une fenêtre de navigation privée (sans être connecté). Sinon, télécharge la vidéo et importe le fichier.',
  ].join('\n'));
}

/** Fichier importé illisible. */
function unreadableFile(err) {
  console.warn('[source] fichier', String(err && err.message || err).slice(-400));
  return userError([
    'Ce fichier n’a pas pu être lu. Causes possibles :',
    '• l’envoi a été coupé : le fichier est incomplet (réessaie avec une bonne connexion) ;',
    '• le fichier est abîmé, ou ce n’est pas une vidéo ;',
    '• le format n’est pas pris en charge : exporte ta vidéo en MP4 (H.264) et réessaie.',
  ].join('\n'));
}

/** Échec imprévu pendant l'analyse : on liste les causes possibles selon la source. */
function unexpected(sourceType) {
  return [
    'L’analyse a échoué. Causes possibles :',
    sourceType === 'upload' ? '• le fichier est abîmé ou incomplet (envoi coupé) ;' : '• la vidéo récupérée est incomplète ou abîmée ;',
    '• la vidéo n’a pas de son ou pas d’image exploitable ;',
    '• le serveur a été redémarré pendant l’analyse (mise à jour du site).',
    'Relance l’analyse : ton crédit n’a pas été utilisé. Si ça recommence, exporte la vidéo en MP4 (H.264) et importe le fichier.',
  ].join('\n');
}

module.exports = { clock, linkKind, assertUsableLink, tooLong, platformFailure, unreadableFile, unexpected, fmtDur };
