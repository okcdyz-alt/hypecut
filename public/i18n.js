/* HYPECUT — version anglaise.
 * Le site est écrit en français ; ce fichier traduit automatiquement tout ce qui s'affiche
 * (texte, placeholders, infobulles), y compris ce qui apparaît après coup (messages, listes…).
 * Langue : choix enregistré, sinon anglais si le navigateur est en anglais, sinon français.
 */
(function () {
  'use strict';
  let lang = 'fr';
  try { lang = localStorage.getItem('hc_lang') || ''; } catch {}
  if (lang !== 'fr' && lang !== 'en') lang = /^en\b/i.test((navigator.languages && navigator.languages[0]) || navigator.language || '') ? 'en' : 'fr';
  window.HC_LANG = lang;
  document.documentElement.lang = lang;

  window.HCsetLang = function (l) {
    try { localStorage.setItem('hc_lang', l); } catch {}
    location.reload();
  };

  function bindToggle() {
    const b = document.getElementById('langBtn');
    if (!b) return;
    b.textContent = lang === 'en' ? 'FR' : 'EN';
    b.setAttribute('aria-label', lang === 'en' ? 'Passer en français' : 'Switch to English');
    b.addEventListener('click', () => window.HCsetLang(lang === 'en' ? 'fr' : 'en'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle); else bindToggle();

  if (lang !== 'en') return;

  const D = {
    // ---- en-tête, navigation, bannières
    'Créer': 'Create', 'Mes clips': 'My clips', 'Offres': 'Pricing', 'Admin': 'Admin', 'Connexion': 'Log in', 'Mon compte': 'My account',
    'HYPECUT, accueil': 'HYPECUT, home',
    'Version démo : tout est traité dans ton navigateur, rien n’est envoyé. Les liens YouTube/Twitch, la HD sans filigrane et les comptes arrivent avec le site complet.': 'Demo version: everything runs in your browser, nothing is uploaded. YouTube/Twitch links, HD without watermark and accounts come with the full site.',
    '🎮 Prêt pour GTA VI': '🎮 Ready for GTA VI', '🎮 GTA VI sort demain': '🎮 GTA VI drops tomorrow', '🎮 GTA VI sort aujourd’hui': '🎮 GTA VI drops today',
    'Prêt pour la sortie de GTA VI': 'Ready for the GTA VI launch',
    'Tes meilleurs moments,': 'Your best moments,', 'découpés par l’IA.': 'clipped by AI.',
    'Colle un lien ou importe ta vidéo de gameplay. HYPECUT repère les poursuites, les explosions et les cris, puis te sort des clips verticaux prêts pour TikTok, Shorts et Reels.': 'Paste a link or upload your gameplay. HYPECUT spots the chases, explosions and screams, then turns them into vertical clips ready for TikTok, Shorts and Reels.',
    'J’en profite': 'Claim it', 'Voir les offres': 'See pricing',
    // ---- source
    '🔗 Coller un lien': '🔗 Paste a link', '📁 Importer un fichier': '📁 Upload a file', 'Lien de la vidéo': 'Video link',
    'twitch.tv/videos/… · kick.com/… · youtube.com/… · lien .mp4': 'twitch.tv/videos/… · kick.com/… · youtube.com/… · .mp4 link',
    'Twitch et Kick (VOD et clips), Google Drive, Dropbox, Vimeo, Streamable, lien direct vers un fichier vidéo. YouTube : selon disponibilité.': 'Twitch and Kick (VODs and clips), Google Drive, Dropbox, Vimeo, Streamable, direct video file links. YouTube: when available.',
    'Je confirme avoir le droit d’utiliser cette vidéo (c’est mon contenu, ou j’ai l’accord de son auteur).': 'I confirm I have the right to use this video (it’s my content, or I have the creator’s permission).',
    '⚠️ YouTube bloque souvent les téléchargements depuis les serveurs : si ça échoue, importe directement ton fichier vidéo. Et n’utilise que tes propres vidéos ou celles dont tu as l’accord de l’auteur.': '⚠️ YouTube often blocks downloads from servers: if it fails, upload your video file instead. And only use your own videos or ones you have permission for.',
    'Les liens arrivent avec le site complet. En attendant, importe ton fichier.': 'Links come with the full site. For now, upload your file.',
    'Dépose ta vidéo ici': 'Drop your video here', 'ou clique pour choisir un fichier (MP4, MOV, WEBM…)': 'or click to choose a file (MP4, MOV, WEBM…)',
    'Durée des clips': 'Clip length', 'Nombre de clips': 'Number of clips', 'Priorité': 'Focus',
    'Équilibré': 'Balanced', 'Action (mouvement)': 'Action (movement)', 'Son (cris, explosions)': 'Sound (screams, explosions)',
    '⚡ Trouver les moments forts': '⚡ Find the highlights',
    'Analyse en cours…': 'Analyzing…',
    // ---- espace de travail
    'Moments forts': 'Highlights', '✨ Titres IA': '✨ AI titles', '⬇ Exporter tout': '⬇ Export all', '＋ Nouvelle vidéo': '＋ New video',
    'intensité détectée ·': 'detected intensity ·', 'clips proposés · clique sur la courbe pour te déplacer': 'suggested clips · click the curve to jump',
    'Intensité de la vidéo dans le temps. Clique pour te déplacer.': 'Video intensity over time. Click to jump.',
    'La vidéo source a été supprimée de nos serveurs (24 h). Tu peux encore revoir les moments forts, mais il faut relancer l’analyse pour exporter.': 'The source video was deleted from our servers (24 h). You can still review the highlights, but you need to run the analysis again to export.',
    '▶ Aperçu': '▶ Preview', 'Créer le clip': 'Create clip', 'Télécharger': 'Download',
    '🔊 Pic sonore': '🔊 Sound peak', '💥 Impact': '💥 Impact', '🏎️ Action': '🏎️ Action', '⚡ Flash / explosion': '⚡ Flash / explosion', '🔥 Moment fort': '🔥 Highlight',
    'drôle': 'funny', 'crash': 'crash', 'poursuite': 'chase', 'explosion': 'explosion',
    // ---- export
    'Format': 'Format', 'Aperçu du cadrage': 'Framing preview', 'Le cadre suivra automatiquement l’action pendant le clip': 'The frame will follow the action automatically',
    'Encadre ta caméra': 'Frame your camera', '(glisse sur l’image)': '(drag on the image)', 'Image de la vidéo pour encadrer la caméra': 'Video frame to select the camera',
    'Position de la caméra': 'Camera position', '↖ Haut gauche': '↖ Top left', '↗ Haut droite': '↗ Top right', '↙ Bas gauche': '↙ Bottom left', '↘ Bas droite': '↘ Bottom right',
    'Cadrage horizontal du jeu': 'Horizontal game framing', 'Cadrage horizontal': 'Horizontal framing',
    'Effets': 'Effects', 'Barre de progression': 'Progress bar', '(pousse à regarder jusqu’au bout)': '(keeps viewers watching to the end)', '🔒 Pro': '🔒 Pro', '🔒 PRO': '🔒 PRO',
    'Afficher un titre sur le clip': 'Show a title on the clip', 'Ex. : La poursuite la plus folle de Vice City': 'E.g.: The craziest chase in Vice City',
    'Début': 'Start', 'Fin': 'End', '⬇ Exporter': '⬇ Export', '⬇ Exporter (1 crédit)': '⬇ Export (1 credit)', '⬇ Exporter le clip': '⬇ Export clip',
    'Plus de crédits : voir les offres': 'Out of credits: see pricing', '⬇ Télécharger': '⬇ Download', '⬇ Enregistrer': '⬇ Save', '📋 Copier la légende': '📋 Copy caption', 'Fermer': 'Close',
    'Envoi de la demande…': 'Sending request…', 'En file d’attente': 'Queued', 'Montage du clip': 'Editing clip', 'Mise en ligne': 'Uploading', 'Recadrage IA en cours': 'AI reframing', 'Traitement': 'Processing',
    'Le serveur est très sollicité, on patiente…': 'The server is busy, hang on…', 'Préparation…': 'Preparing…',
    'Ton clip est prêt ! 🎉': 'Your clip is ready! 🎉', 'Invite tes amis': 'Invite your friends', ': 5 clips offerts chacun.': ': 5 free clips each.',
    'Ce format est inclus dans les offres Pro et Créateur.': 'This format is included in Pro and Creator.', 'Les effets sont inclus dans les offres Pro et Créateur.': 'Effects are included in Pro and Creator.',
    'Légende copiée.': 'Caption copied.', 'Copie impossible : sélectionne le texte à la main.': 'Copy failed: select the text manually.', 'Clip enregistré.': 'Clip saved.', 'Enregistrement impossible ici.': 'Saving isn’t possible here.',
    'L’export a échoué. Ton crédit a été remboursé.': 'Export failed. Your credit was refunded.',
    // ---- formats
    'Jeu plein écran': 'Full-screen game', 'Recadré sur le centre de l’action': 'Cropped on the action',
    'Jeu + fond flouté': 'Game + blurred background', 'Toute l’image visible, fond flou': 'Full image visible, blurred background',
    'Caméra en haut': 'Camera on top', 'Facecam en haut, jeu en bas': 'Facecam on top, game below',
    'Caméra en bas': 'Camera at bottom', 'Jeu en haut, facecam en bas': 'Game on top, facecam below',
    'Moitié / moitié': 'Half / half', '50 % caméra, 50 % jeu': '50% camera, 50% game',
    'Caméra en bulle': 'Camera bubble', 'Bulle ronde dans un coin': 'Round bubble in a corner',
    'Caméra incrustée': 'Picture-in-picture', 'Petit cadre caméra dans un coin': 'Small camera frame in a corner',
    'Recadrage IA': 'AI reframing', 'Le cadre suit l’action (Cloudinary)': 'The frame follows the action (Cloudinary)',
    'Carré 1:1': 'Square 1:1', 'Instagram, X': 'Instagram, X', 'Paysage 16:9': 'Landscape 16:9', 'YouTube classique': 'Classic YouTube',
    'Fond flouté': 'Blurred background', 'Satisfaisant': 'Satisfying', 'FACECAM': 'FACECAM',
    'La poursuite la plus folle': 'The craziest chase', 'Le crash de l’année': 'Crash of the year', 'L’explosion de trop': 'One explosion too many', 'Regarde jusqu’au bout': 'Watch till the end',
    // ---- page d'accueil
    'Comment ça marche': 'How it works', 'Colle ton lien': 'Paste your link', 'Une VOD Twitch ou Kick, une vidéo YouTube ou ton fichier de gameplay.': 'A Twitch or Kick VOD, a YouTube video or your gameplay file.',
    'L’IA trouve les moments forts': 'AI finds the highlights', 'Elle écoute les cris et les explosions, repère l’action et classe les meilleurs passages.': 'It listens for screams and explosions, spots the action and ranks the best moments.',
    'Exporte en un clic': 'Export in one click', 'Choisis un format, ajuste si tu veux, et récupère ton clip prêt à poster.': 'Pick a format, tweak if you like, and grab your clip ready to post.',
    'Un format pour chaque style': 'A format for every style', 'Caméra du streamer, bulle, fond flouté ou modèle « satisfaisant » : tout est prêt pour TikTok, Shorts et Reels.': 'Streamer cam, bubble, blurred background or “satisfying” template: everything is ready for TikTok, Shorts and Reels.',
    'Tout ce qu’il faut pour percer': 'Everything you need to blow up',
    '🎯 Détection automatique': '🎯 Automatic detection', 'Le son et l’image sont analysés pour trouver les vrais temps forts, pas des passages au hasard.': 'Sound and video are analyzed to find the real highlights, not random moments.',
    '🎥 Formats caméra': '🎥 Camera formats', 'Encadre ta facecam une fois : HYPECUT monte le clip en haut, en bas, en bulle ou en incrustation.': 'Frame your facecam once: HYPECUT places it on top, at the bottom, in a bubble or as picture-in-picture.',
    '✨ Titres et hashtags': '✨ Titles and hashtags', 'Chaque clip reçoit un titre accrocheur, une légende et des hashtags prêts à copier.': 'Every clip gets a catchy title, a caption and hashtags ready to copy.',
    '🔗 Twitch, Kick, YouTube': '🔗 Twitch, Kick, YouTube', 'Colle directement le lien de ta VOD ou de ton clip, ou importe ton fichier.': 'Paste your VOD or clip link directly, or upload your file.',
    '🤖 Recadrage IA': '🤖 AI reframing', 'En vertical, le cadre suit l’action tout seul pour ne jamais rater le moment.': 'In vertical, the frame follows the action on its own so you never miss the moment.',
    '⚡ Sans logiciel': '⚡ No software', 'Tout se passe dans ton navigateur, sur ordinateur comme sur téléphone.': 'Everything happens in your browser, on desktop or phone.',
    'Prêt pour la sortie de GTA VI ?': 'Ready for the GTA VI launch?', 'Crée ton compte gratuit et transforme tes premières sessions en clips.': 'Create your free account and turn your first sessions into clips.',
    '⚡ Créer mon premier clip': '⚡ Create my first clip',
    'Questions fréquentes': 'FAQ',
    'C’est vraiment gratuit ?': 'Is it really free?', 'Oui : l’inscription est gratuite et donne des clips offerts, sans carte bancaire. Pendant la semaine de sortie de GTA VI, toutes les fonctions Pro sont incluses. Ensuite, tu peux continuer en essai gratuit ou choisir une offre.': 'Yes: signing up is free and comes with free clips, no card needed. During GTA VI launch week, all Pro features are included. After that, you can keep the free trial or pick a plan.',
    'Quels liens sont acceptés ?': 'Which links are supported?', 'Les VOD et clips Twitch et Kick, Google Drive, Dropbox, Vimeo, Streamable et les liens directs vers un fichier vidéo. YouTube bloque parfois nos serveurs : dans ce cas, importe simplement ton fichier.': 'Twitch and Kick VODs and clips, Google Drive, Dropbox, Vimeo, Streamable and direct video file links. YouTube sometimes blocks our servers: in that case, just upload your file.',
    'Combien de temps ça prend ?': 'How long does it take?', 'L’analyse dure généralement de quelques secondes à quelques minutes selon la longueur de la vidéo. Chaque export prend environ une minute.': 'Analysis usually takes from a few seconds to a few minutes depending on video length. Each export takes about a minute.',
    'Mes vidéos sont-elles conservées ?': 'Are my videos stored?', 'Non : la vidéo d’origine est supprimée de nos serveurs 24 heures après l’analyse. Tes clips restent disponibles au téléchargement depuis « Mes clips ».': 'No: the original video is deleted from our servers 24 hours after analysis. Your clips stay available to download from “My clips”.',
    'Ai-je le droit de publier ces clips ?': 'Am I allowed to post these clips?', 'Tu dois avoir les droits sur la vidéo d’origine : ton propre gameplay ou tes propres streams, ou une vidéo dont l’auteur t’a donné l’accord. Respecte aussi les règles de l’éditeur du jeu et des plateformes où tu publies.': 'You must own the rights to the original video: your own gameplay or streams, or a video whose creator gave you permission. Also follow the game publisher’s rules and those of the platforms you post on.',
    'Comment annuler mon abonnement ?': 'How do I cancel my subscription?', 'En un clic, depuis « Mon compte → Gérer mon abonnement ». L’abonnement s’arrête à la fin de la période déjà payée, sans frais.': 'In one click, from “My account → Manage subscription”. It stops at the end of the period already paid, at no cost.',
    // ---- pied de page, légal
    'Mentions légales': 'Legal notice', 'CGV / CGU': 'Terms', 'Confidentialité': 'Privacy', 'Contact': 'Contact',
    'HYPECUT n’est ni affilié ni approuvé par Rockstar Games ou Take-Two Interactive. Grand Theft Auto est une marque de Take-Two Interactive. N’utilise que des vidéos dont tu as les droits.': 'HYPECUT is not affiliated with or endorsed by Rockstar Games or Take-Two Interactive. Grand Theft Auto is a trademark of Take-Two Interactive. Only use videos you have the rights to.',
    'HYPECUT n’est ni affilié ni approuvé par Rockstar Games ou Take-Two Interactive. Grand Theft Auto est une marque de Take-Two Interactive.': 'HYPECUT is not affiliated with or endorsed by Rockstar Games or Take-Two Interactive. Grand Theft Auto is a trademark of Take-Two Interactive.',
    'Informations légales': 'Legal information', '← Retour au site': '← Back to site', 'Conditions générales d’utilisation et de vente': 'Terms of use and sale', 'Politique de confidentialité': 'Privacy policy',
    // ---- comptes
    'Crée ton compte gratuit': 'Create your free account', 'Content de te revoir': 'Welcome back', 'Inscription': 'Sign up',
    'E-mail': 'Email', 'Mot de passe': 'Password', '8 caractères minimum': 'At least 8 characters', 'Créer mon compte': 'Create my account', 'Se connecter': 'Log in',
    'En créant un compte, tu acceptes les': 'By creating an account, you accept the', 'conditions générales': 'terms', 'et la': 'and the', 'politique de confidentialité': 'privacy policy',
    'Connecte-toi pour retrouver tes clips.': 'Log in to find your clips.', 'Connecté.': 'Logged in.', 'Déconnecté.': 'Logged out.',
    'E-mail ou mot de passe incorrect.': 'Wrong email or password.', 'Adresse e-mail invalide.': 'Invalid email address.', 'Le mot de passe doit faire au moins 8 caractères.': 'Password must be at least 8 characters.',
    'Un compte existe déjà avec cette adresse.': 'An account already exists with this email.', 'Connecte-toi pour continuer.': 'Log in to continue.',
    'Mes vidéos analysées': 'My analyzed videos', 'Chargement…': 'Loading…', 'Aucune vidéo pour l’instant.': 'No videos yet.', 'Analyse ta première vidéo': 'Analyze your first video',
    'Tu n’es pas connecté.': 'You’re not logged in.', 'Offre': 'Plan', 'Crédits restants': 'Credits left', 'Renouvellement': 'Renewal', 'Qualité d’export': 'Export quality',
    'Gérer mon abonnement': 'Manage subscription', 'Passer à Pro': 'Upgrade to Pro', 'Se déconnecter': 'Log out',
    '📈 Gagne des clips avec tes vidéos': '📈 Earn clips with your videos', 'Les règles (à lire avant de publier)': 'The rules (read before posting)', 'Envoyer': 'Send', 'vidéos envoyées': 'videos sent', 'validées': 'approved',
    '⏳ En vérification': '⏳ Under review', '✅ Validée': '✅ Approved', '❌ Refusée': '❌ Rejected', 'Recompter les vues': 'Recount views', 'Vérification sous 48 h environ': 'Reviewed within about 48 h',
    'Lien de ta vidéo TikTok ou Reels': 'Link to your TikTok or Reels video', 'Gagner des clips': 'Earn clips', '🎁 Plus de crédits ? Gagne des clips gratuitement': '🎁 Out of credits? Earn clips for free',
    'Publie une vidéo TikTok ou Reels qui présente HYPECUT : tu gagnes des clips selon ses vues. Tu peux aussi parrainer tes amis.': 'Post a TikTok or Reels video featuring HYPECUT and earn clips based on its views. You can also invite your friends.',
    'J’ai 18 ans ou plus et ma vidéo respecte les règles ci-dessus, mention de collaboration commerciale comprise.': 'I am 18 or older and my video follows the rules above, including the paid-partnership label.',
    'Colle d’abord le lien de ta vidéo.': 'Paste your video link first.', 'Vidéo envoyée ! On vérifie ses vues et tu reçois tes clips.': 'Video sent! We check its views and you get your clips.', 'C’est noté : on recompte les vues de ta vidéo.': 'Got it: we will recount your video’s views.',
    'Coche la case pour confirmer que ta vidéo respecte les règles du programme.': 'Tick the box to confirm your video follows the program rules.', 'Cette vidéo a déjà été envoyée.': 'This video has already been sent.',
    'Colle le lien d’une vidéo TikTok ou d’un Reel Instagram (par exemple https://www.tiktok.com/@toncompte/video/…).': 'Paste the link of a TikTok video or an Instagram Reel (e.g. https://www.tiktok.com/@youraccount/video/…).',
    'vidéos créateurs à vérifier': 'creator videos to review',
    'Revenus': 'Earnings', 'Défi GTA VI': 'GTA VI challenge', 'Mes revenus de clippeur': 'My clipper earnings', '🏆 Le défi GTA VI de la semaine': '🏆 This week’s GTA VI challenge',
    'Note tes campagnes et tes clips publiés : tu vois ce que tu gagnes, ce qui reste à payer et ce qui marche le mieux.': 'Log your campaigns and posted clips: see what you earn, what is still unpaid and what works best.',
    'Un thème par semaine. Publie ton meilleur clip, envoie le lien : les 3 meilleurs gagnent des clips.': 'One theme a week. Post your best clip, send the link: the top 3 win clips.',
    'gagnés au total': 'earned in total', 'déjà reçus': 'already received', 'en attente de paiement': 'awaiting payment', 'ce mois-ci': 'this month', 'vues au total': 'total views', 'en moyenne pour 1 000 vues': 'average per 1,000 views',
    'Gains par semaine': 'Earnings per week', '8 dernières semaines, selon la date de publication': 'Last 8 weeks, by posting date', '📋 Mes campagnes': '📋 My campaigns', '🎬 Ajouter un clip publié': '🎬 Add a posted clip', '📈 Mes clips publiés': '📈 My posted clips',
    'Ajouter la campagne': 'Add campaign', 'Ajouter le clip': 'Add clip', 'Sans campagne': 'No campaign', 'Déjà payé': 'Already paid', 'Publié le': 'Posted on', 'Vues': 'Views', 'Gains': 'Earnings', 'Payé': 'Paid', 'Clip': 'Clip', 'Campagne': 'Campaign', 'Clips': 'Clips', 'Terminer': 'End', 'Réactiver': 'Reactivate', 'estimé': 'estimated',
    'Comment ça marche ?': 'How does it work?', '🏆 Je participe': '🏆 Enter', 'Défis passés': 'Past challenges', 'Résultats bientôt.': 'Results soon.', '● EN COURS': '● LIVE', 'Se connecter pour participer': 'Log in to enter', 'Pas de défi en cours pour le moment.': 'No challenge running right now.',
    'Recevoir les conseils et les annonces de défis par e-mail': 'Get tips and challenge announcements by email',
    '🔗 Lien Twitch / Kick': '🔗 Twitch / Kick link', '📁 Importer un fichier (YouTube…)': '📁 Upload a file (YouTube…)', 'Lien de ta VOD ou de ton clip Twitch ou Kick': 'Link to your Twitch or Kick VOD or clip',
    'Liens acceptés :': 'Accepted links:', 'Twitch et Kick uniquement': 'Twitch and Kick only', '(VOD et clips). Pour une vidéo YouTube ou un autre fichier, utilise l’onglet « Importer un fichier ».': '(VODs and clips). For a YouTube video or any other file, use the “Upload a file” tab.',
    '⚠️ Les liens YouTube ne sont pas acceptés : passe par l’onglet « Importer un fichier ». Pour ta propre vidéo, télécharge-la depuis YouTube Studio (menu ⋮ → Télécharger), puis importe-la.': '⚠️ YouTube links are not supported: use the “Upload a file” tab. For your own video, download it from YouTube Studio (⋮ menu → Download), then upload it.',
    'Importer un fichier': 'Upload a file', 'Vidéo YouTube ?': 'YouTube video?', 'Télécharge ta propre vidéo depuis YouTube Studio (menu ⋮ → Télécharger), puis importe le fichier ici. N’utilise que tes vidéos ou celles dont tu as l’accord de l’auteur.': 'Download your own video from YouTube Studio (⋮ menu → Download), then upload the file here. Only use your own videos or ones you have the creator’s permission for.',
    'Un lien de VOD Twitch ou Kick, ou ton fichier vidéo (YouTube, gameplay enregistré…).': 'A Twitch or Kick VOD link, or your video file (YouTube, recorded gameplay…).',
    '🔗 Twitch, Kick et fichiers': '🔗 Twitch, Kick and files', 'Colle le lien de ta VOD ou de ton clip Twitch ou Kick, ou importe ton fichier (vidéo YouTube, gameplay enregistré…).': 'Paste your Twitch or Kick VOD or clip link, or upload your file (YouTube video, recorded gameplay…).',
    'Uniquement les liens Twitch et Kick (VOD et clips). Pour tout le reste, vidéos YouTube comprises, importe le fichier : pour ta propre vidéo YouTube, télécharge-la depuis YouTube Studio (menu ⋮ → Télécharger).': 'Only Twitch and Kick links (VODs and clips). For everything else, YouTube videos included, upload the file: for your own YouTube video, download it from YouTube Studio (⋮ menu → Download).',
    'Les liens YouTube ne sont pas acceptés : importe ton fichier vidéo (onglet « Importer un fichier »).': 'YouTube links are not supported: upload your video file (“Upload a file” tab).', 'Seuls les liens Twitch et Kick sont acceptés. Pour une autre vidéo, importe le fichier.': 'Only Twitch and Kick links are supported. For another video, upload the file.',
    'Les liens YouTube ne sont pas acceptés : importe ton fichier vidéo (onglet « Importer un fichier »). Pour ta propre vidéo YouTube, télécharge-la depuis YouTube Studio.': 'YouTube links are not supported: upload your video file (“Upload a file” tab). For your own YouTube video, download it from YouTube Studio.',
    'Seuls les liens Twitch et Kick sont acceptés. Pour une autre vidéo, importe le fichier (onglet « Importer un fichier »).': 'Only Twitch and Kick links are supported. For another video, upload the file (“Upload a file” tab).',
    'Sous-titres automatiques': 'Automatic subtitles', '(mot par mot, comme sur TikTok)': '(word by word, TikTok style)', 'Écriture des sous-titres': 'Writing subtitles',
    '⏱ Choisir un passage de la vidéo': '⏱ Choose a part of the video', 'Début': 'Start', 'Fin': 'End',
    'Seul ce passage est récupéré et analysé : c’est plus rapide. Laisse vide pour analyser toute la vidéo.': 'Only this part is fetched and analysed, which is faster. Leave empty to analyse the whole video.',
    'Pas de vidéo sous la main ?': 'No video at hand?', '🎮 Essayer avec une vidéo d’exemple': '🎮 Try with a sample video',
    '✋ Fais glisser le titre et les sous-titres pour les placer où tu veux.': '✋ Drag the title and subtitles to place them wherever you like.', '↺ Positions par défaut': '↺ Default positions',
    '🎁 Parraine tes amis': '🎁 Invite your friends', 'Ton lien de parrainage': 'Your referral link', 'Copier': 'Copy', 'inscrits': 'signed up', 'validés': 'validated', 'clips gagnés': 'clips earned',
    'Lien copié : partage-le à tes amis !': 'Link copied: share it with your friends!', 'Sélectionne le lien et copie-le.': 'Select the link and copy it.',
    // ---- statuts
    'Envoi incomplet': 'Incomplete upload', 'Récupération de la vidéo': 'Fetching video', 'Recherche des moments forts': 'Finding highlights', 'Préparation des aperçus': 'Preparing previews', 'Préparation du lecteur': 'Preparing player', 'L’IA écrit les titres': 'Writing titles', 'Terminé': 'Done', 'Erreur': 'Error', 'Expirée': 'Expired',
    'Envoi de ta vidéo…': 'Uploading your video…', 'Connexion instable, nouvelle tentative…': 'Unstable connection, retrying…', 'Vidéo reçue, démarrage de l’analyse…': 'Video received, starting analysis…',
    'Ouverture de la vidéo…': 'Opening video…', 'Écoute du son…': 'Listening to the audio…', 'Analyse des images…': 'Analyzing frames…', 'Préparation des aperçus…': 'Preparing previews…',
    'Écoute du son et analyse des images…': 'Listening to the audio and analyzing frames…', 'Téléchargement de la vidéo…': 'Downloading video…', 'Récupération de la vidéo…': 'Fetching video…', 'Préparation du lecteur…': 'Preparing player…', 'L’IA écrit les titres…': 'Writing titles…',
    'Choisis d’abord une vidéo.': 'Choose a video first.', 'Colle d’abord le lien de ta vidéo.': 'Paste your video link first.', 'Coche la case pour confirmer que tu as le droit d’utiliser cette vidéo.': 'Tick the box to confirm you have the right to use this video.',
    'Ce fichier n’est pas une vidéo.': 'This file isn’t a video.', 'La connexion a été coupée pendant l’envoi. Réessaie.': 'The connection dropped during upload. Try again.',
    'L’analyse a échoué.': 'The analysis failed.', 'Analyse introuvable.': 'Analysis not found.', 'Une erreur est survenue.': 'Something went wrong.',
    'La vidéo n’a pas pu être analysée. Vérifie le fichier ou le lien et réessaie.': 'The video couldn’t be analyzed. Check the file or link and try again.',
    'Ce lien mène à une page web, pas à un fichier vidéo. Colle un lien direct (.mp4) ou un lien YouTube/Twitch.': 'This link leads to a web page, not a video file. Paste a direct (.mp4) link or a YouTube/Twitch link.',
    'YouTube bloque temporairement les téléchargements depuis nos serveurs. Réessaie plus tard ou importe ton fichier.': 'YouTube is temporarily blocking downloads from our servers. Try again later or upload your file.',
    'Kick bloque temporairement les téléchargements depuis nos serveurs. Réessaie dans quelques minutes ou importe ton fichier.': 'Kick is temporarily blocking downloads from our servers. Try again in a few minutes or upload your file.',
    'Cette vidéo est privée ou réservée aux abonnés.': 'This video is private or subscribers-only.', 'Impossible de découper un live en cours : attends la fin du stream (VOD).': 'Can’t clip a live stream in progress: wait for the VOD.',
    'Vidéo introuvable ou supprimée.': 'Video not found or deleted.', 'Ce lien n’est pas pris en charge.': 'This link isn’t supported.', 'Ce lien n’est pas valide.': 'This link isn’t valid.',
    'Confirme que tu as le droit d’utiliser cette vidéo.': 'Confirm you have the right to use this video.', 'Tu n’as plus de crédits. Choisis une offre pour continuer à créer des clips.': 'You’re out of credits. Choose a plan to keep creating clips.',
    'Ce format est réservé aux offres Pro et Créateur.': 'This format is reserved for Pro and Creator.', 'L’export de tous les clips en un clic est inclus dans l’offre Créateur.': 'One-click export of all clips is included in Creator.',
    'Le site a été mis à jour : recharge la page (Ctrl+Maj+R ou Cmd+Maj+R) puis relance l’envoi.': 'The site was updated: reload the page (Ctrl+Shift+R or Cmd+Shift+R) and upload again.',
    'Tu as lancé beaucoup d’analyses : patiente un peu.': 'You’ve started a lot of analyses: please wait a bit.', 'Trop de tentatives. Réessaie dans quelques minutes.': 'Too many attempts. Try again in a few minutes.',
    'Le paiement en ligne arrive très bientôt.': 'Online payment is coming very soon.', 'Coche la case d’accès immédiat pour continuer.': 'Tick the immediate-access box to continue.',
    'Paiement annulé : rien n’a été débité.': 'Payment cancelled: nothing was charged.', 'Paiement confirmé, activation de ton offre…': 'Payment confirmed, activating your plan…',
    // ---- offres
    'Choisis ton offre': 'Choose your plan', 'Essaie gratuitement, puis passe à la vitesse supérieure.': 'Try it free, then level up.',
    'Pour la sortie de GTA VI, toutes les fonctions Pro sont offertes cette semaine. Les abonnements arrivent juste après.': 'For the GTA VI launch, all Pro features are free this week. Subscriptions come right after.',
    'Offre de lancement GTA VI : Pro à moitié prix le premier mois, jusqu’au 30 novembre.': 'GTA VI launch offer: Pro at half price for the first month, until November 30.',
    'Je demande l’accès immédiat à mes crédits dès le paiement et je renonce expressément à mon droit de rétractation de 14 jours (article L221-28, 13° du Code de la consommation). J’accepte les': 'I request immediate access to my credits upon payment and expressly waive my 14-day right of withdrawal (French Consumer Code, article L221-28, 13°). I accept the',
    'conditions générales de vente': 'terms of sale',
    'Essai gratuit': 'Free trial', 'Pass lancement GTA VI': 'GTA VI launch pass', 'Créateur': 'Creator', 'Pro': 'Pro', 'Pack 20 clips': '20-clip pack',
    'Le plus populaire': 'Most popular', '🎮 Offre lancement GTA VI': '🎮 GTA VI launch offer', '🎮 Semaine de sortie GTA VI': '🎮 GTA VI launch week',
    'Commencer gratuitement': 'Start for free', 'J’en profite gratuitement': 'Get it free', 'Créer un clip': 'Create a clip', 'Ton offre actuelle': 'Your current plan', 'Disponible sur le site complet': 'Available on the full site',
    'Besoin de quelques clips en plus, sans abonnement ?': 'Need a few more clips, without a subscription?',
    'Paiement sécurisé par Stripe : carte bancaire, Apple Pay, Google Pay, PayPal. Abonnement sans engagement, résiliable en un clic.': 'Secure payment by Stripe: card, Apple Pay, Google Pay, PayPal. No commitment, cancel in one click.',
    '1 crédit = 1 clip exporté': '1 credit = 1 exported clip',
    'Sans filigrane': 'No watermark', 'Tous les formats caméra': 'All camera formats', 'Titres, légendes et hashtags automatiques': 'Automatic titles, captions and hashtags',
    'Vidéos jusqu’à 2 h': 'Videos up to 2 h', 'Vidéos jusqu’à 20 min': 'Videos up to 20 min', 'VOD jusqu’à 6 h': 'VODs up to 6 h', 'Formats 9:16, 1:1 et 16:9': '9:16, 1:1 and 16:9 formats',
    'Recadrage IA qui suit l’action': 'AI reframing that follows the action', 'Tout Pro inclus': 'Everything in Pro', 'File d’attente prioritaire': 'Priority queue',
    'Export de tous les clips en un clic': 'One-click export of all clips', 'Sous-titres automatiques (bientôt)': 'Automatic subtitles (soon)',
    '3 clips offerts (5 pendant la semaine de sortie)': '3 free clips (5 during launch week)', '100 clips par mois': '100 clips per month', '400 clips par mois': '400 clips per month',
    // ---- admin
    'Tableau de bord': 'Dashboard', '↻ Actualiser': '↻ Refresh', 'Gestion des comptes': 'Account management', 'Rechercher un e-mail…': 'Search an email…', 'Rechercher un compte': 'Search an account', 'Rechercher': 'Search',
    'Inscrits et activité': 'Sign-ups and activity', 'Argent': 'Revenue', 'Santé du serveur': 'Server health', 'Formats les plus utilisés': 'Most used formats',
    'comptes au total': 'total accounts', 'inscrits aujourd’hui': 'signed up today', 'inscrits sur 7 jours': 'signed up in 7 days', 'venus par parrainage': 'from referrals', 'vidéos analysées': 'videos analyzed', 'clips créés': 'clips created', 'clips sur 7 jours': 'clips in 7 days',
    'Inscriptions par jour': 'Sign-ups per day', 'Clips créés par jour': 'Clips created per day', '14 derniers jours': 'Last 14 days',
    'abonnés Pro': 'Pro subscribers', 'abonnés Créateur': 'Creator subscribers', 'revenu mensuel des abonnements (estimé)': 'monthly subscription revenue (estimate)', 'packs vendus ce mois': 'packs sold this month', 'revenu des packs ce mois': 'pack revenue this month',
    'Estimation au prix plein, hors réductions et frais Stripe. Les montants exacts sont dans ton tableau de bord Stripe.': 'Full-price estimate, excluding discounts and Stripe fees. Exact amounts are in your Stripe dashboard.',
    'traitements en cours': 'jobs running', 'en file d’attente': 'queued', 'exports en échec (24 h)': 'failed exports (24 h)', 'analyses en échec (24 h)': 'failed analyses (24 h)', 'vidéos stockées': 'stored videos', 'espace disque libre': 'free disk space', 'mémoire utilisée': 'memory used', 'depuis le dernier démarrage': 'since last restart',
    'Aucune erreur d’export récente.': 'No recent export errors.', 'Dernières erreurs d’export': 'Latest export errors', 'Aucun compte trouvé.': 'No account found.', 'Compte mis à jour.': 'Account updated.',
    'Clips': 'Clips', 'Crédits': 'Credits', 'Inscrit le': 'Signed up', 'Actions': 'Actions', 'Appliquer': 'Apply', 'offre…': 'plan…', 'Gratuit': 'Free',
    '💳 = abonnement Stripe actif. Changer l’offre ici l’offre sans paiement (geste commercial).': '💳 = active Stripe subscription. Changing the plan here grants it without payment (goodwill gesture).',
    'Accès réservé.': 'Restricted access.',
    'Écran partagé satisfaisant': 'Satisfying split screen',
    'Clip en haut, vidéo satisfaisante en bas (50/50)': 'Clip on top, satisfying video below (50/50)', '🔥 Tendance TikTok': '🔥 Trending on TikTok',
    'Clip en haut, vidéo satisfaisante en bas : le format qui garde les gens jusqu’à la fin.': 'Clip on top, satisfying video below: the format that keeps people watching to the end.',
    '🔥 Nouveau': '🔥 New', 'Ton clip + une vidéo satisfaisante, écran partagé 50/50 →': 'Your clip + a satisfying video, 50/50 split screen →',
    '🔥 Le format qui cartonne sur TikTok': '🔥 The format blowing up on TikTok',
    'Ton clip GTA en haut, une vidéo satisfaisante en bas (nettoyage de tapis, slime, sable…). Les yeux restent scotchés, les vues suivent.': 'Your GTA clip on top, a satisfying video below (rug cleaning, slime, sand…). Eyes stay glued, views follow.',
    'Écran coupé en deux, 50/50, au format vertical 9:16': 'Screen split in two, 50/50, vertical 9:16', 'Bibliothèque de vidéos satisfaisantes libres de droits': 'Library of royalty-free satisfying videos',
    'Seul le son de ton clip est gardé': 'Only your clip’s sound is kept', 'Barre de progression pour pousser à regarder jusqu’au bout': 'Progress bar that pushes viewers to watch to the end',
    '⚡ Créer mon clip satisfaisant': '⚡ Create my satisfying clip', 'Satisfaisant 50/50': 'Satisfying 50/50',
    'Écran partagé satisfaisant, caméra du streamer, bulle ou fond flouté : tout est prêt pour TikTok, Shorts et Reels.': 'Satisfying split screen, streamer cam, bubble or blurred background: everything is ready for TikTok, Shorts and Reels.', 'Clip en haut, vidéo satisfaisante en bas': 'Clip on top, satisfying video below',
    'Vidéo satisfaisante (en bas)': 'Satisfying video (bottom)', 'Aucune vidéo satisfaisante pour l’instant.': 'No satisfying videos yet.',
    'Choisis une vidéo satisfaisante pour le bas de l’écran.': 'Pick a satisfying video for the bottom of the screen.',
    'Téléchargement ou conversion impossible. Vérifie que le lien mène bien à un fichier vidéo.': 'Download or conversion failed. Check that the link points to a video file.',
    'Vidéos satisfaisantes (bibliothèque)': 'Satisfying videos (library)', 'Ajouter': 'Add', 'Retirer': 'Remove', 'La bibliothèque est vide.': 'The library is empty.',
    '⏳ Conversion en cours…': '⏳ Converting…', 'Vidéo ajoutée : conversion en cours…': 'Video added: converting…', 'Colle d’abord le lien de la vidéo.': 'Paste the video link first.',
    'Nom (ex. : Nettoyage de tapis)': 'Name (e.g. Rug cleaning)', 'Lien de la vidéo de fond': 'Background video link', 'Nom de la vidéo': 'Video name', 'Crédits à offrir': 'Credits to grant', 'Ton lien de parrainage': 'Your referral link',
  };

  const P = [
    [/^🎮 Sortie de GTA VI dans (\d+) jours$/, (m) => `🎮 GTA VI drops in ${m[1]} days`],
    [/^(\d+) crédits? · (.+)$/, (m) => `${m[1]} credit${m[1] === '1' ? '' : 's'} · ${D[m[2]] || m[2]}`],
    [/^(\d+) clips? proposés? sur (.+) de vidéo\. Modifie les titres, ajuste et exporte\.$/, (m) => `${m[1]} suggested clip${m[1] === '1' ? '' : 's'} from ${m[2]} of video. Edit the titles, adjust and export.`],
    [/^Moments forts · (.+)$/, (m) => `Highlights · ${m[1]}`],
    [/^Moment fort n°(\d+)$/, (m) => `Highlight #${m[1]}`],
    [/^Créer le clip n°(\d+)$/, (m) => `Create clip #${m[1]}`],
    [/^Titre du clip (\d+)$/, (m) => `Clip ${m[1]} title`],
    [/^Lire l’aperçu du clip (\d+)$/, (m) => `Play clip ${m[1]} preview`],
    [/^Potentiel (\d+)\/10$/, (m) => `Potential ${m[1]}/10`],
    [/^(\d+) clips offerts pour essayer, sans carte bancaire\.$/, (m) => `${m[1]} free clips to try, no card needed.`],
    [/^Crée ton compte gratuit pour analyser ta vidéo : (\d+) clips offerts\.$/, (m) => `Create your free account to analyze your video: ${m[1]} free clips.`],
    [/^Bienvenue ! Tu as (\d+) crédits pour essayer\.$/, (m) => `Welcome! You have ${m[1]} credits to try.`],
    [/^Un ami t’invite sur HYPECUT : tu gagnes (\d+) clips en plus après ton premier clip 🎁$/, (m) => `A friend invited you to HYPECUT: get ${m[1]} extra clips after your first clip 🎁`],
    [/^Partage ton lien : quand un ami s’inscrit et crée son premier clip, vous gagnez$/, () => 'Share your link: when a friend signs up and creates their first clip, you both get'],
    [/^([\d,.  ]+) vues comptées · ([\d,.  ]+) clips gagnés$/, (m) => `${m[1]} views counted · ${m[2]} clips earned`],
    [/^(TikTok|Instagram) · (.+)$/, (m) => `${m[1]} · ${m[2]}`],
    [/^(\d+) clips chacun$/, (m) => `${m[1]} clips each`],
    [/^Qualité : (\d+)p (\d+) i\/s( avec filigrane)? · il te reste (\d+) crédits?\.$/, (m) => `Quality: ${m[1]}p ${m[2]} fps${m[3] ? ' with watermark' : ''} · ${m[4]} credit${m[4] === '1' ? '' : 's'} left.`],
    [/^Démo : 720p avec filigrane, rendu en temps réel dans ton navigateur \(garde l’onglet ouvert\)\.$/, () => 'Demo: 720p with watermark, rendered live in your browser (keep the tab open).'],
    [/^(\d+)p (\d+) i\/s( · filigrane)?$/, (m) => `${m[1]}p ${m[2]} fps${m[3] ? ' · watermark' : ''}`],
    [/^(\d+)p (avec|sans) filigrane$/, (m) => `${m[1]}p ${m[2] === 'avec' ? 'with' : 'no'} watermark`],
    [/^(\d+)p (\d+) i\/s, qualité maximale$/, (m) => `${m[1]}p ${m[2]} fps, top quality`],
    [/^(\d+) clips offerts$/, (m) => `${m[1]} free clips`],
    [/^Jusqu’au (.+)$/, (m) => `Until ${m[1]}`],
    [/^Choisir (.+)$/, (m) => `Choose ${D[m[1]] || m[1]}`],
    [/^le 1er mois, puis (.+)\/mois$/, (m) => `first month, then ${m[1]}/month`],
    [/^\/ mois$/, () => '/ month'],
    [/^(.+) : (\d+) crédits valables sans limite de temps\.$/, (m) => `${D[m[1]] || m[1]}: ${m[2]} credits that never expire.`],
    [/^(.+) · Acheter$/, (m) => `${m[1]} · Buy`],
    [/^Merci ! Ton offre (.+) est active \((\d+) crédits\)\.$/, (m) => `Thanks! Your ${D[m[1]] || m[1]} plan is active (${m[2]} credits).`],
    [/^Position dans la file : (\d+)$/, (m) => `Queue position: ${m[1]}`],
    [/^(\d+) \/ (\d+) Mo$/, (m) => `${m[1]} / ${m[2]} MB`],
    [/^(.+) · (\d+) Mo$/, (m) => `${m[1]} · ${m[2]} MB`],
    [/^(\d+(?:[.,]\d+)?) (Mo|Go)$/, (m) => `${m[1]} ${m[2] === 'Mo' ? 'MB' : 'GB'}`],
    [/^Montage en temps réel… (\d+) % \(garde cet onglet ouvert\)$/, (m) => `Live editing… ${m[1]}% (keep this tab open)`],
    [/^Ton clip est prêt \((.+) Mo, (\w+)\) ! 🎉$/, (m) => `Your clip is ready (${m[1]} MB, ${m[2]})! 🎉`],
    [/^(.+)…\s*\(position (\d+)\)$/, (m) => `${D[m[1]] || m[1]}… (position ${m[2]})`],
    [/^(.+)…$/, (m) => (D[m[1]] ? `${D[m[1]]}…` : null)],
    [/^(\d+) clips?$/, (m) => `${m[1]} clip${m[1] === '1' ? '' : 's'}`],
    [/^🎮 Pass lancement GTA VI : toutes les fonctions Pro offertes jusqu’au (.+) · (\d+) clips gratuits sans filigrane, avec formats caméra et titres automatiques ·$/, (m) => `🎮 GTA VI launch pass: all Pro features free until ${m[1]} · ${m[2]} free clips, no watermark, camera formats and automatic titles ·`],
    [/^🎮 Offre de lancement GTA VI : Pro à (.+) le premier mois au lieu de (.+), jusqu’au 30 novembre · code$/, (m) => `🎮 GTA VI launch offer: Pro at ${m[1]} for the first month instead of ${m[2]}, until November 30 · code`],
    [/^· 5 clips offerts à l’inscription ·$/, () => '· 5 free clips on sign-up ·'],
    [/^Cette vidéo dure (\d+) min : ton offre accepte jusqu’à (\d+) min\.(.*)$/, (m) => `This video is ${m[1]} min long: your plan accepts up to ${m[2]} min.${m[3] ? ' Upgrade for long VODs.' : ''}`],
    [/^Fichier trop lourd pour ton offre \(max (\d+) Mo\)\.$/, (m) => `File too large for your plan (max ${m[1]} MB).`],
    [/^Vidéo trop lourde pour ton offre \(max (\d+) Mo\)\.$/, (m) => `Video too large for your plan (max ${m[1]} MB).`],
    [/^Récupération depuis (.+)…$/, (m) => `Fetching from ${m[1] === 'la plateforme' ? 'the platform' : m[1]}…`],
    [/^Erreur (\d+)$/, (m) => `Error ${m[1]}`],
    [/^✅ Prête · (\d+) s$/, (m) => `✅ Ready · ${m[1]} s`],
    [/^(✅|⏳) (.+?) ·( .*)?$/, (m) => `${m[1]} ${D[m[2]] || m[2]} ·${m[3] ? m[3].replace(' %', '%').replace('(file :', '(queue:') : ''}`],
    [/^⚠️ (.+?) : (.+)$/, (m) => `⚠️ ${D[m[1]] || m[1]}: ${D[m[2]] || m[2]}`],
  ];

  function tr(text) {
    const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
    const core = text.trim();
    if (!core) return null;
    // En anglais, pas d'espace avant : ; ! ?
    const fix = (out) => (/^[:;!?]/.test(out) ? '' : lead) + out + trail;
    if (D[core]) return fix(D[core]);
    for (const [re, fn] of P) { const m = core.match(re); if (m) { const out = fn(m); if (out) return fix(out); } }
    return null;
  }
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function translateNode(n) {
    if (n.nodeType === 3) {
      const p = n.parentNode;
      if (!p || /^(SCRIPT|STYLE|TEXTAREA|CODE)$/.test(p.nodeName)) return;
      const out = tr(n.nodeValue);
      if (out !== null && out !== n.nodeValue) n.nodeValue = out;
      return;
    }
    if (n.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(n.nodeName)) return;
    for (const a of ATTRS) {
      if (!n.hasAttribute(a)) continue;
      const cur = n.getAttribute(a), out = tr(cur);
      if (out !== null && out !== cur) n.setAttribute(a, out);
    }
    if (n.nodeName === 'INPUT' && n.type === 'button') { const out = tr(n.value); if (out && out !== n.value) n.value = out; }
    for (const c of n.childNodes) translateNode(c);
  }
  // Exposé pour les textes dessinés (canvas) ou les messages d'erreur
  window.HCt = (s) => { const out = tr(String(s)); return out === null ? s : out; };

  function start() {
    translateNode(document.body);
    if (document.title) document.title = window.HCt(document.title);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
