# Agentic Ad Campaign Creator

An agent-native creative production engine with a human-facing workspace. An AI
agent directs production through a structured engine (REST and MCP); a person
supervises through a variation grid.

Status: **milestones 1–2 of 12 complete** (technical foundation; workspace with variation grid and agent panel).
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

Then, in three terminals:

```bash
pnpm dev:api          # REST API on :4000
```

```bash
pnpm dev:worker       # background job processor
```

```bash
pnpm dev:web          # web app on :3000
```

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
| `packages/storage` | Asset storage interface and local-disk driver |
| `packages/jobs` | Durable background jobs (pg-boss dispatch, `jobs` table as source of truth) |
| `apps/api` | REST API |
| `apps/worker` | Job worker process |
| `apps/web` | Next.js web app |
