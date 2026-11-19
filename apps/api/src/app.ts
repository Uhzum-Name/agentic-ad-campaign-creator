import { AppError, type Config, toErrorBody } from "@adengine/core";
import type { Db } from "@adengine/db";
import type { JobSystem } from "@adengine/jobs";
import type { Storage } from "@adengine/storage";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { campaignRoutes } from "./routes/campaigns.ts";
import { designRoutes } from "./routes/designs.ts";
import { planningRoutes } from "./routes/planning.ts";
import { variationRoutes } from "./routes/variations.ts";
import { creativeRoutes } from "./routes/creative.ts";
import { jobRoutes } from "./routes/jobs.ts";
import { registerMcpRoute } from "./mcp.ts";
import { projectRoutes } from "./routes/projects.ts";

/*
 * REST conventions (all under /v1):
 *   - JSON in, JSON out.
 *   - Success:  { "data": <resource | resource[]> }
 *   - Failure:  { "error": { "code", "message", "details"? } } with a matching HTTP status.
 *   - Long-running work returns 202 with a job; poll GET /v1/jobs/:id.
 *   - Auth: "Authorization: Bearer <API_KEY>" when API_KEY is configured.
 */

export interface AppDeps {
  db: Db;
  jobs: JobSystem;
  storage: Storage;
  config: Pick<Config, "apiKey">;
}

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new AppError(
      "validation_error",
      "Request validation failed",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

function tokenMatches(header: string | undefined, apiKey: string): boolean {
  const given = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(apiKey);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.httpStatus).send({ error: err.toBody() });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: "validation_error", message: (err as Error).message } });
    }
    console.error("[api] unhandled error:", err);
    return reply.status(500).send({ error: toErrorBody(new AppError("internal_error", "Internal server error")) });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: `No route for ${req.method} ${req.url}` } }),
  );

  // Binary uploads (font files). Each route sets its own size limit.
  app.addContentTypeParser(["application/octet-stream", "font/ttf", "font/otf", "font/woff", "font/woff2", "font/sfnt", "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"], { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.get("/health", async () => ({ status: "ok" }));
  registerMcpRoute(app);

  app.register(
    async (v1) => {
      v1.addHook("onRequest", async (req) => {
        const { apiKey } = deps.config;
        if (apiKey && !tokenMatches(req.headers.authorization, apiKey)) {
          throw new AppError("unauthorized", "Missing or invalid API key. Send 'Authorization: Bearer <key>'.");
        }
      });
      projectRoutes(v1, deps);
      campaignRoutes(v1, deps);
      creativeRoutes(v1, deps);
      designRoutes(v1, deps);
      planningRoutes(v1, deps);
      variationRoutes(v1, deps);
      jobRoutes(v1, deps);
    },
    { prefix: "/v1" },
  );

  return app;
}
