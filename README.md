# BangkokTOR backend

Bun + Express 5 + Mongoose.

## Layout

```
index.ts              entry point
src/
  app.ts              express app wiring (middleware order lives here)
  server.ts           connect mongo, listen, graceful shutdown
  config/env.ts       env parsing + validation
  db/mongo.ts         mongoose connection, ping, readyState
  middleware/errors.ts  404 + central error handler, HttpError
  routes/
    index.ts          root router — mount feature routers here
    health.route.ts   /health, /health/ready
```

## Run locally

```sh
cp .env.example .env
docker compose up -d mongo    # or point MONGODB_URI at Atlas
bun run dev
```

## Endpoints

| Route           | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `GET /`         | Banner                                                     |
| `GET /health`   | Liveness — process is up, touches nothing                  |
| `GET /health/ready` | Readiness — pings Mongo, `503` when it can't be reached |

## Adding a feature

1. `src/models/thing.model.ts` — the mongoose schema.
2. `src/routes/thing.route.ts` — the router.
3. Mount it in [src/routes/index.ts](src/routes/index.ts).

Throw `new HttpError(400, "...")` for client errors; async handlers reject straight
into the error middleware (Express 5 does this for you).

## Deploy

Self-hosted runner deploys via `docker compose up -d --build` on merge to `main`.
