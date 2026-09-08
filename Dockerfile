FROM node:24-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=3210 NODE_ENV=production MEMEROOM_DATA_DIR=/data
EXPOSE 3210
CMD ["node", "server/index.mjs"]

COPY LICENSE AUTHORS.md ./
