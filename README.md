# HYPECUT

Site qui trouve automatiquement les moments forts d’une vidéo de gameplay et en fait des clips prêts pour TikTok, YouTube Shorts et Reels. Il est prêt pour la sortie de GTA VI (19 novembre 2026).

## Ce que fait le site

- **Sources** : fichier importé, lien direct (.mp4), YouTube, Twitch (VOD et clips), Kick (VOD et clips), Google Drive, Dropbox, Vimeo, Streamable.
- **Détection des moments forts** : analyse du son (volume, cris, explosions) et de l’image (mouvement, changements de plan, flashs), courbe d’intensité et clips proposés.
- **Formats** : jeu plein écran, jeu avec fond flouté, caméra en haut, caméra en bas, moitié/moitié, caméra en bulle, caméra incrustée, recadrage IA qui suit l’action (Cloudinary), carré 1:1, paysage 16:9. Le client encadre sa caméra sur une image de sa vidéo.
- **IA** : titres accrocheurs, légendes, hashtags et note de viralité pour chaque clip (API Claude).
- **Comptes et crédits** : e-mail et mot de passe, 1 crédit = 1 clip exporté, crédit remboursé si l’export échoue.
- **Offres** : Essai gratuit, Pro et Créateur, plus un pack de 20 clips. Paiement par Stripe : carte, Apple Pay, Google Pay et PayPal.
- **Lancement GTA VI** : Pro à 3,99 € le premier mois (code `GTAVI`) jusqu’au 30 novembre, et 5 clips offerts à l’inscription jusqu’au 26 novembre.

## Offres (modifiables dans `lib/plans.js`)

| | Essai | Pro | Créateur |
|---|---|---|---|
| Prix | 0 € | 7,99 €/mois (3,99 € le 1er mois au lancement) | 19,99 €/mois |
| Clips | 3 (5 pendant la semaine de sortie) | 100/mois | 400/mois |
| Qualité | 720p, filigrane | 1080p, sans filigrane | 1080p 60 i/s, qualité max |
| Durée max de la vidéo | 20 min | 2 h | 6 h |
| Formats caméra et recadrage IA | non | oui | oui |
| Titres IA | meilleur clip seulement | tous | tous |
| File prioritaire, export en lot | non | non | oui |

## Mise en ligne sur Render

1. Pousse ce dossier sur un dépôt GitHub.
2. Sur Render, crée un « Blueprint » à partir du dépôt : `render.yaml` configure tout (serveur Docker, disque persistant de 20 Go, région Francfort).
3. Renseigne les variables :
   - `CLOUDINARY_URL` : dans Cloudinary, *Settings → API Keys*, copie la ligne `cloudinary://…`.
   - `STRIPE_SECRET_KEY` : dans Stripe, *Développeurs → Clés API*. Commence par `sk_test_…` pour tester, puis passe à `sk_live_…`.
   - `ANTHROPIC_API_KEY` : sur console.anthropic.com, pour les titres IA.
   - `ADMIN_EMAILS` : ton e-mail. Ton compte reçoit l’offre Créateur pour tester.
4. Au premier démarrage, le serveur crée lui-même dans Stripe les produits, les prix, le coupon de lancement, le code `GTAVI` et le webhook.
5. Dans Stripe, *Paramètres → Moyens de paiement*, active Apple Pay, Google Pay et PayPal.

Chaque variable est facultative : sans Cloudinary, les clips sont servis par le serveur ; sans Stripe, les offres s’affichent avec « Paiement bientôt disponible » ; sans clé IA, les clips n’ont pas de titre automatique.

### Variables avancées

| Variable | Rôle | Défaut |
|---|---|---|
| `MAX_PARALLEL_JOBS` | traitements vidéo simultanés | 2 |
| `SOURCE_TTL_HOURS` | durée de conservation des vidéos sources | 24 |
| `ALLOW_PLATFORM_LINKS` | `false` pour désactiver YouTube, Twitch et Kick | activé |
| `YTDLP_COOKIES` | cookies (format Netscape) si YouTube bloque le serveur | — |
| `ANTHROPIC_MODEL` | modèle utilisé pour les titres | `claude-haiku-5-5` |
| `LAUNCH_END`, `LAUNCH_BONUS_END` | fin de l’offre de lancement et du bonus d’inscription | 30/11 et 26/11/2026 |

## Lancer en local

Il faut Node.js 22.13 ou plus et ffmpeg (et yt-dlp pour les liens de plateformes).

```bash
npm start              # http://localhost:3000
```

Si `index.html` est ouvert sans le serveur, le site passe en mode démo : l’analyse et l’export se font entièrement dans le navigateur.

## Organisation du code

```
server.js            serveur web et API (aucune dépendance npm)
lib/plans.js         offres, prix, offre de lancement
lib/db.js            base SQLite intégrée à Node (comptes, crédits, analyses, exports)
lib/auth.js          inscription, connexion, sessions
lib/jobs.js          file d'attente : analyse puis export
lib/media.js         ffmpeg : analyse, vignettes, montage des formats
lib/sources.js       téléchargement (lien direct protégé, yt-dlp)
lib/cloudinary.js    stockage, diffusion, recadrage IA
lib/ai.js            titres, légendes et hashtags (Claude)
lib/stripe.js        paiement, abonnements, webhook
public/              site (HTML, CSS, JS) ; scoring.js et layouts.js servent aussi au serveur
```

## Avertissements

- Les conditions d’utilisation de YouTube interdisent de télécharger une vidéo sans l’accord de son auteur. Le site demande à l’utilisateur de confirmer qu’il a les droits, mais la responsabilité finale reste celle de l’exploitant. YouTube et Kick bloquent parfois les serveurs d’hébergement ; dans ce cas, l’utilisateur voit un message clair qui l’invite à importer son fichier.
- HYPECUT n’est ni affilié ni approuvé par Rockstar Games ou Take-Two Interactive.
