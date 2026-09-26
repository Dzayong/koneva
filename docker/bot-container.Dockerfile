# Builds the wa-bot image that device-manager spawns per WhatsApp device.
# Build from the repo root: docker build -f docker/bot-container.Dockerfile -t wa-bot:latest .

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN addgroup -S -g 10001 botcontainer && adduser -S -D -H -u 10001 -G botcontainer botcontainer \
  && mkdir -p /app/sessions && chown botcontainer:botcontainer /app /app/sessions

USER botcontainer

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BOT_CONTAINER_PORT||9000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/bot-container/index.js"]
