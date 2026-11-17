import { CreateJobInput } from "@adengine/core";
import type { FastifyInstance } from "fastify";
import { type AppDeps, parse } from "../app.ts";
import { requireProject } from "./projects.ts";

export function jobRoutes(app: FastifyInstance, { db, jobs }: AppDeps): void {
  app.post("/jobs", async (req, reply) => {
    const input = parse(CreateJobInput, req.body);
    if (input.projectId) await requireProject(db, input.projectId);
    const job = await jobs.submit(input.type, input.input, { projectId: input.projectId });
    return reply.status(202).send({ data: job });
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (req) => ({ data: await jobs.get(req.params.id) }));

  app.post<{ Params: { id: string } }>("/jobs/:id/cancel", async (req) => ({ data: await jobs.cancel(req.params.id) }));
}
