FROM node:22-bookworm-slim

# ffmpeg (montage vidéo), polices, Python pour yt-dlp (YouTube, Twitch, Kick…)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core python3 python3-pip ca-certificates curl \
 && pip3 install --no-cache-dir --break-system-packages -U "yt-dlp[default]" \
 && mkdir -p /usr/share/fonts/hypecut \
 && (curl -fsSL -o /usr/share/fonts/hypecut/Anton-Regular.ttf https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf || true) \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

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
