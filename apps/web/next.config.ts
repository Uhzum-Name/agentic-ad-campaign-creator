import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// Local development: pick up the repo-root .env (real environment variables win).
const rootEnv = join(process.cwd(), "..", "..", ".env");
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}

/*
 * The browser always calls same-origin /api/*. Two ways to serve it:
 *   - Default: the engine API runs inside this app (src/app/api/[...path]),
 *     so one process — or one Vercel project — serves both site and API.
 *   - API_URL set: /api/* is proxied to a separately running API server.
 */
const apiUrl = process.env.API_URL;

const config: NextConfig = {
  transpilePackages: ["@adengine/core", "@adengine/db", "@adengine/jobs", "@adengine/storage", "@adengine/api", "@adengine/design", "@adengine/engine", "@adengine/figma", "@adengine/fonts", "@adengine/mcp"],
  async rewrites() {
    if (!apiUrl) return [];
    return { beforeFiles: [{ source: "/api/:path*", destination: `${apiUrl}/v1/:path*` }], afterFiles: [], fallback: [] };
  },
};

export default config;
