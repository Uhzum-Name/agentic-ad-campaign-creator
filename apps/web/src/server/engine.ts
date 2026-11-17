import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "@adengine/api";
import { connect } from "@adengine/db";
import { JobSystem, createDefaultRegistry } from "@adengine/jobs";
import { LocalStorage } from "@adengine/storage";
import type { FastifyInstance } from "fastify";

/*
 * The engine API, embedded in the web app. Built once per server instance.
 * Database migrations are NOT run here; they run at build/deploy time
 * (`pnpm db:migrate`). Jobs can be submitted, but only a separately running
 * worker process executes them.
 */
const globalForEngine = globalThis as unknown as { __adengine?: Promise<FastifyInstance> };

async function create(): Promise<FastifyInstance> {
  // Read straight from the environment: locally next.config.ts loads the
  // repo's .env; on a host such as Vercel the variables are set in its settings.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { db } = connect(databaseUrl);
  const jobs = new JobSystem({ db, databaseUrl, registry: await createDefaultRegistry() });
  // Temp-dir storage: serverless hosts only allow writes there. Nothing reads
  // or writes stored assets yet; durable object storage is required before it does.
  const storage = new LocalStorage(join(tmpdir(), "adengine-storage"));
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
