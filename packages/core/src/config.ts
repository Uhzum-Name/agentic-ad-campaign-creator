import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

/** Walks up from cwd to find the repo root (the dir holding pnpm-workspace.yaml). */
export function findRepoRoot(from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

/** Minimal .env loader: real environment variables always win. */
function loadDotEnv(root: string): void {
  const file = join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const [, key, raw] = m as unknown as [string, string, string];
    if (process.env[key] === undefined) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  API_PORT: z.coerce.number().int().default(4000),
  API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/storage"),
});

export interface Config {
  repoRoot: string;
  databaseUrl: string;
  testDatabaseUrl?: string;
  apiPort: number;
  apiKey?: string;
  storage: { driver: "local"; localDir: string };
}

export function loadConfig(): Config {
  const repoRoot = findRepoRoot();
  loadDotEnv(repoRoot);
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration (${problems}). See .env.example.`);
  }
  const e = parsed.data;
  return {
    repoRoot,
    databaseUrl: e.DATABASE_URL,
    testDatabaseUrl: e.TEST_DATABASE_URL,
    apiPort: e.API_PORT,
    apiKey: e.API_KEY,
    storage: { driver: e.STORAGE_DRIVER, localDir: resolve(repoRoot, e.STORAGE_LOCAL_DIR) },
  };
}
