FROM node:22-bookworm-slim

# ffmpeg (montage vidéo), polices, Python pour yt-dlp (YouTube, Twitch, Kick…)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core python3 python3-pip ca-certificates curl \
 && pip3 install --no-cache-dir --break-system-packages -U "yt-dlp[default]" \
 && mkdir -p /usr/share/fonts/hypecut \
 && (curl -fsSL -o /usr/share/fonts/hypecut/Anton-Regular.ttf https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf || true) \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Sous-titres automatiques : faster-whisper (gratuit, sur le processeur) + modèle « base » téléchargé à la construction.
# Si l'installation échoue, le site fonctionne quand même : les clips sont exportés sans sous-titres.
ENV WHISPER_DIR=/opt/whisper WHISPER_MODEL=base
RUN (pip3 install --no-cache-dir --break-system-packages faster-whisper \
 && python3 -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8', download_root='/opt/whisper')") \
 || echo "faster-whisper indisponible : sous-titres désactivés"

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production \
    PORT=10000 \
    DATA_DIR=/var/data
EXPOSE 10000
CMD ["node", "--no-warnings", "server.js"]
