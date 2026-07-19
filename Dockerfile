# Dockerfile для деплоя Next.js-бэкенда и админ-панели на VDS
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Миграции БД: запускаются внутри контейнера командой `node scripts/migrate.mjs`
COPY --from=builder /app/scripts ./scripts
# undici нужен сервису bot (scripts/bot-polling.mjs) для прокси к Telegram API
COPY --from=deps /app/node_modules/undici ./node_modules/undici
# Каталог хранилища (скины и пр.). Создаём и отдаём пользователю app: при
# первом монтировании named-volume Docker наследует этих владельца/права,
# иначе volume создаётся под root и app не может писать (EACCES -> 500).
RUN mkdir -p /data/politempire/skins && chown -R app:app /data/politempire
USER app
EXPOSE 3000
CMD ["node", "server.js"]
