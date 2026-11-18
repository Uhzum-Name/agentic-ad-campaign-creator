/**
 * Imports one Figma frame into a project from the command line, using the
 * same code path as the API's import job. For trying real files locally.
 *
 *   pnpm exec tsx scripts/import-figma.mts <figma-link> [project-id]
 *
 * Without a project id, a project named "Figma import check" is created.
 * Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1 so Node's fetch uses it.
 */
import { loadConfig } from "@adengine/core/config";
import { connect, migrate, projects } from "@adengine/db";
import { importFigmaDesign } from "@adengine/engine";
import { parseFigmaUrl } from "@adengine/figma";
import { createStorage } from "@adengine/storage";

const [link, projectArg] = process.argv.slice(2);
if (!link) {
  console.error("usage: tsx scripts/import-figma.mts <figma-link> [project-id]");
  process.exit(1);
}
const config = loadConfig();
const handle = connect(config.databaseUrl);
await migrate(handle.db);
const { fileKey, nodeId } = parseFigmaUrl(link);
if (!nodeId) throw new Error("The link has no node-id; copy a link to a selected frame.");
let projectId = projectArg;
if (!projectId) {
  const [p] = await handle.db.insert(projects).values({ name: "Figma import check" }).returning();
  projectId = p!.id;
}
const started = Date.now();
try {
  const design = await importFigmaDesign(
    { db: handle.db, storage: createStorage(config.storage, handle.db) },
    { token: config.figmaToken },
    { projectId, fileKey, nodeId },
    async (f, m) => console.log(`${Math.round(f * 100)}%  ${m}`),
  );
  console.log(JSON.stringify({ projectId, designId: design.id, name: design.name, size: `${design.width}x${design.height}`, seconds: (Date.now() - started) / 1000, report: design.importReport }, null, 2));
} catch (err) {
  console.error("IMPORT FAILED:", err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
