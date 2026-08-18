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

USER bun
ENTRYPOINT ["bun", "run", "index.ts"]
