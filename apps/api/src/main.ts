import { loadConfig } from "@adengine/core/config";
import { connect, migrate } from "@adengine/db";
import { createEngineRegistry } from "@adengine/engine";
import { JobSystem } from "@adengine/jobs";
import { createStorage } from "@adengine/storage";
import { buildApp } from "./app.ts";

const config = loadConfig();
const handle = connect(config.databaseUrl);
await migrate(handle.db);

const storage = createStorage(config.storage, handle.db);
const registry = createEngineRegistry({ db: handle.db, storage, figma: { token: config.figmaToken } });
const jobs = new JobSystem({ db: handle.db, databaseUrl: config.databaseUrl, registry });
// The API only enqueues (the queue connects on first use); the worker process executes.

const app = buildApp({ db: handle.db, jobs, storage, config });
await app.listen({ port: config.apiPort, host: "0.0.0.0" });
console.log(`[api] listening on http://localhost:${config.apiPort}${config.apiKey ? " (API key required)" : " (no API key set)"}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await jobs.stop();
    await handle.close();
    process.exit(0);
  });
}
