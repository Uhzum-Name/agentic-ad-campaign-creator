import { loadConfig } from "@adengine/core/config";
import { connect, migrate } from "@adengine/db";
import { createEngineRegistry } from "@adengine/engine";
import { JobSystem } from "@adengine/jobs";
import { createStorage } from "@adengine/storage";

const config = loadConfig();
const handle = connect(config.databaseUrl);
await migrate(handle.db);

const storage = createStorage(config.storage, handle.db);
const registry = createEngineRegistry({ db: handle.db, storage, figma: { token: config.figmaToken } });
const jobs = new JobSystem({ db: handle.db, databaseUrl: config.databaseUrl, registry });
await jobs.work();
console.log(`[worker] processing job types: ${registry.list().map((d) => d.type).join(", ")}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await jobs.stop();
    await handle.close();
    process.exit(0);
  });
}
