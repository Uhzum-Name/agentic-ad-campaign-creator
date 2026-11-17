# Architecture

## Thesis

The product is a creative production **engine** that an AI agent operates
through structured operations, with a human-facing interface on top. The
interface and the agent are both clients of the engine; neither is required
for the other to work.

## Processes

```
 Browser ──► web (Next.js) ──/api proxy──┐
                                         ▼
 External agent ──MCP (milestone 10)──► api ──► PostgreSQL ◄── worker
 (Claude Code, Claude desktop, …)        │        (data + job queue)   │
                                         └──────► storage ◄────────────┘
```

- **api** — REST under `/v1`. Validates, persists, enqueues. Never does long work inline.
  It can run as its own server (`apps/api`) or embedded in the web app
  (`apps/web/src/app/api/[...path]`), which is the default and what lets one
  Vercel project serve both. Set `API_URL` to proxy to a separate server instead.
- **worker** — executes jobs. Can be scaled or restarted independently.
- **web** — UI only. Talks to the API through a same-origin `/api/*` proxy.

## Where the intelligence lives

The engine has **no built-in LLM dependency and needs no model API key**.
The agent is whichever MCP client the user connects (for example Claude Code
or the Claude apps, on the user's own subscription). That agent reads project
state and calls engine tools; the engine executes deterministically.

Consequences:

- Operations that need judgement (interpreting a brief, proposing directions,
  writing copy, choosing a layout option, translating "fade in the headline"
  into an animation spec) are performed by the connected agent, which submits
  **structured results** to the engine. The engine validates and stores them.
- The in-app agent panel is a live view of that agent's activity plus a channel
  for the user to leave direction that the agent picks up through MCP. It does
  not generate replies on its own.
- A server-side model provider can be added later behind one interface if an
  in-app agent that works without an MCP client becomes necessary.

## Data model

`Project → Campaign → Creative Direction → Variation → Format → Rendered Asset`

| Entity | Table | Notes |
|---|---|---|
| Project | `projects` | Top-level container; archivable |
| Campaign | `campaigns` | Status: draft → planning → in_production → in_review → complete |
| Brief | `briefs` | Append-only versions per campaign |
| Design document | `design_documents` | Layer tree as JSON plus its source (fixture, Figma, manual) |
| Layer | inside `design_documents.document` | Not a table; addressed by stable layer id |
| Creative direction | `creative_directions` | Concept, messaging angle, visual treatment |
| Variation | `variations` | **Override patches** on a source design, never a copy |
| Format | `variation_formats` | One size of a variation, with its own layout overrides |
| Animation spec | `animation_specs` | Structured, reusable; shape defined in milestone 7 |
| Rendered asset | `rendered_assets` | Exported file in storage plus its validation report |
| Job | `jobs` | Async execution record |
| Recipe | `recipes` | Saved workflow; versioned |

**Why overrides instead of copies.** A variation is `source design + patches
keyed by layer id`. The original stays intact, "what changed" is a direct read
of the patches, editing one headline touches one patch, and undo/redo is patch
history.

### Design document

Defined in `packages/core/src/design.ts`. A tree of `text`, `image`, `shape`
and `group` layers with geometry relative to the parent. Each layer may carry a
**semantic role** (`headline`, `cta`, `product`, `logo`, …). Roles are what let
variation, resizing and animation target "the CTA" rather than a layer name.
The model is source-agnostic; Figma is one importer.

## API conventions

- JSON in and out, under `/v1`.
- Success: `{ "data": … }`. Failure: `{ "error": { "code", "message", "details"? } }`.
- Error codes: `validation_error` 400, `unauthorized` 401, `not_found` 404,
  `conflict` 409, `internal_error` 500.
- Ids are prefixed (`prj_`, `cmp_`, `job_`, …).
- Long-running work returns `202` with a job. Poll `GET /v1/jobs/:id`.
- Auth: when `API_KEY` is set, send `Authorization: Bearer <key>`. This is a
  single shared key; per-user accounts and permissions are milestone 10–12 work.

Endpoints today: projects (CRUD, archive), campaigns (CRUD), briefs (save new
version, history), campaign workspace (one read for the grid), creative
directions and variations (create, update status, delete), the campaign thread
(post, list, acknowledge), jobs (submit, status, cancel), `/health`.

## Workspace and agent panel

The campaign page is a variation grid grouped by creative direction, with a
persistent side panel. The panel holds the **campaign thread** (`agent_messages`):
people post direction, which stays "waiting" until an agent acknowledges it;
agents post replies and activity entries. The grid and thread poll the API
every few seconds, so work an agent creates through the API appears without a
reload. Polling is a deliberate simple choice; a push channel can replace it
behind the same `useResource` hook.

The web app imports only the browser-safe parts of `@adengine/core`
(`@adengine/core/entities`, `@adengine/core/design`).

## Background jobs

`submit` writes a `jobs` row and enqueues a pg-boss message holding only the
job id. The worker claims the row, runs the registered handler and writes
status, progress, output or a structured error back. Clients read only the
`jobs` table, so work survives a closed browser or agent session.

- **Retries:** per job type (`maxAttempts`), with backoff. A worker crash
  mid-job is redelivered by the queue after its expiry window.
- **Cancellation:** queued jobs cancel immediately; running jobs stop at their
  next progress checkpoint.
- **Queue:** pg-boss on PostgreSQL. Chosen over Redis to avoid a second
  service; the `JobSystem` class is the only code that knows about it.

The only job type so far is `system.ping`, a diagnostic that exercises the
pipeline. It performs no creative work.

## Storage

`Storage` interface (`put`, `get`, `exists`, `delete`) with slash-separated
keys. Only a local-disk driver exists. An S3-compatible driver is planned and
not implemented.

## Decisions

| Decision | Reason |
|---|---|
| TypeScript monorepo | One language and shared schemas across engine, API, MCP and UI |
| No GSAP | Its license restricts use in products that let users create animations without code; we will compile our own keyframe spec to the Web Animations API |
| Postgres queue, not Redis | One less service; swappable |
| One DOM renderer for preview, editor, HTML5 export and capture | Preview and export cannot drift |
| MCP-first agent, no server-side LLM | No per-token cost to operate; the user's own Claude is the agent |
| Packages export TypeScript source, run with `tsx` | No build step during early development |

## Deployment (preview)

Website and API deploy as one Vercel project (root directory `apps/web`) with
a hosted PostgreSQL database (`DATABASE_URL`). Migrations run during the build.
The **worker is not deployed** on Vercel, which cannot run an always-on
process: jobs can be submitted there but stay queued. A worker host is needed
before rendering and export work (milestone 9). Asset storage on Vercel is
temporary; durable object storage is needed before designs are imported.

## Known limitations

- No user accounts; a single optional shared API key.
- No S3 driver.
- Variation cards show production state only; rendering the creative arrives with milestone 3.
- No side-by-side comparison or export status in the grid yet.
- Figma access is not wired up; the design model is schema-only until milestone 3.
