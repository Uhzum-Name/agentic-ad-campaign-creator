import { AppError, CreateProjectInput, UpdateProjectInput } from "@adengine/core";
import { type Db, projects } from "@adengine/db";
import { desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { type AppDeps, parse } from "../app.ts";

export async function requireProject(db: Db, id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) throw AppError.notFound("Project", id);
  return row;
}

export function projectRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.post("/projects", async (req, reply) => {
    const input = parse(CreateProjectInput, req.body);
    const [row] = await db.insert(projects).values(input).returning();
    return reply.status(201).send({ data: row });
  });

  app.get<{ Querystring: { includeArchived?: string } }>("/projects", async (req) => {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        archivedAt: projects.archivedAt,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        campaignCount: sql<number>`(select count(*)::int from campaigns c where c.project_id = "projects"."id")`,
      })
      .from(projects)
      .where(req.query.includeArchived === "true" ? undefined : isNull(projects.archivedAt))
      .orderBy(desc(projects.createdAt));
    return { data: rows };
  });

  app.get<{ Params: { id: string } }>("/projects/:id", async (req) => ({
    data: await requireProject(db, req.params.id),
  }));

  app.patch<{ Params: { id: string } }>("/projects/:id", async (req) => {
    const { archived, ...fields } = parse(UpdateProjectInput, req.body);
    await requireProject(db, req.params.id);
    const [row] = await db
      .update(projects)
      .set({ ...fields, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }), updatedAt: new Date() })
      .where(eq(projects.id, req.params.id))
      .returning();
    return { data: row };
  });

  app.delete<{ Params: { id: string } }>("/projects/:id", async (req, reply) => {
    await requireProject(db, req.params.id);
    await db.delete(projects).where(eq(projects.id, req.params.id));
    return reply.status(204).send();
  });
}
