FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
EXPOSE 8003

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT??8003)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER bun
ENTRYPOINT ["bun", "run", "index.ts"]
