import { loadConfig } from "@adengine/core";
import { connect, migrate } from "./client.ts";

const config = loadConfig();
const urls = [config.databaseUrl, ...(process.argv.includes("--with-test") && config.testDatabaseUrl ? [config.testDatabaseUrl] : [])];
for (const url of urls) {
  const handle = connect(url);
  await migrate(handle.db);
  await handle.close();
  console.log(`migrated ${new URL(url).pathname.slice(1)}`);
}
