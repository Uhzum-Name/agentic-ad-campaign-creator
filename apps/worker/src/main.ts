import { loadConfig } from "@adengine/core";
import { connect, migrate } from "@adengine/db";
import { JobSystem, createDefaultRegistry } from "@adengine/jobs";

const config = loadConfig();
const handle = connect(config.databaseUrl);
await migrate(handle.db);

const registry = await createDefaultRegistry();
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
