import { buildApp } from "@adengine/api";
import { connect } from "@adengine/db";
import { createEngineRegistry } from "@adengine/engine";
import { JobSystem } from "@adengine/jobs";
import { PostgresStorage } from "@adengine/storage";
import type { FastifyInstance } from "fastify";

/*
 * The engine API, embedded in the web app. Built once per server instance.
 * Database migrations are NOT run here; they run at build/deploy time
 * (`pnpm db:migrate`).
 */
const globalForEngine = globalThis as unknown as { __adengine?: Promise<FastifyInstance> };

async function create(): Promise<FastifyInstance> {
  // Read straight from the environment: locally next.config.ts loads the
  // repo's .env; on a host such as Vercel the variables are set in its settings.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { db } = connect(databaseUrl);
  const storage = new PostgresStorage(db);
  const registry = createEngineRegistry({ db, storage, figma: { token: process.env.FIGMA_TOKEN || undefined } });
  // Vercel cannot run a worker process, so there jobs run inside the request
  // that submits them. Elsewhere, set JOBS_MODE=inline to do the same.
  const inline = Boolean(process.env.VERCEL) || process.env.JOBS_MODE === "inline";
  const jobs = new JobSystem({ db, databaseUrl, registry, mode: inline ? "inline" : "queue" });
  const app = buildApp({ db, jobs, storage, config: { apiKey: process.env.API_KEY || undefined } });
  await app.ready();
  return app;
}

export function getEngine(): Promise<FastifyInstance> {
  globalForEngine.__adengine ??= create().catch((err) => {
    globalForEngine.__adengine = undefined; // allow a retry on the next request
    throw err;
  });
  return globalForEngine.__adengine;
}
