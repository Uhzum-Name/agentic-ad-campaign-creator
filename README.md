# Agentic Ad Campaign Creator

An agent-native creative production engine with a human-facing workspace. An AI
agent directs production through a structured engine (REST and MCP); a person
supervises through a variation grid.

Status: **milestones 1–3 of 12 built** (technical foundation; workspace; design model, renderer and Figma import).
See [docs/architecture.md](docs/architecture.md) for the design and
[docs/roadmap.md](docs/roadmap.md) for what is and is not built.

## Run it

Requires Node 22+, pnpm 10+, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env
pnpm dev:services     # Debian/Ubuntu with local Postgres; or: docker compose up -d
pnpm db:migrate
```

Then:

```bash
pnpm dev:web          # web app and API on :3000
```

```bash
pnpm dev:worker       # background job processor (separate terminal)
```

`pnpm dev:api` runs the API as a standalone server on :4000; set `API_URL` for
the web app to use it.

## Test

```bash
pnpm typecheck
```

```bash
pnpm test             # integration tests run against TEST_DATABASE_URL
```

## Layout

| Path | Purpose |
|---|---|
| `packages/core` | Shared schemas: entity inputs, the design document model, ids, errors, config |
| `packages/db` | PostgreSQL schema (Drizzle) and migrations |
| `packages/storage` | Asset storage interface; PostgreSQL (default) and local-disk drivers |
| `packages/design` | Layer inspection, override application and the HTML renderer (browser-safe) |
| `packages/fonts` | Reads family, weight and style from font files (TTF, OTF, WOFF, WOFF2) |
| `packages/figma` | Figma REST client and Figma-to-design converter |
| `packages/engine` | Sample designs, design ingestion, and the engine's job types |
| `packages/jobs` | Durable background jobs (pg-boss dispatch, `jobs` table as source of truth) |
| `apps/api` | REST API |
| `apps/worker` | Job worker process |
| `apps/web` | Next.js web app |
