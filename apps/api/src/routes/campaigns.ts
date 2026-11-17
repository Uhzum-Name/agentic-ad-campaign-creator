import { AppError, CreateCampaignInput, SaveBriefInput, UpdateCampaignInput } from "@adengine/core";
import { type Db, briefs, campaigns } from "@adengine/db";
import { desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { type AppDeps, parse } from "../app.ts";
import { requireProject } from "./projects.ts";

export async function requireCampaign(db: Db, id: string) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!row) throw AppError.notFound("Campaign", id);
  return row;
}

export async function currentBrief(db: Db, campaignId: string) {
  const [row] = await db.select().from(briefs).where(eq(briefs.campaignId, campaignId)).orderBy(desc(briefs.version)).limit(1);
  return row ?? null;
}

export function campaignRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/campaigns", async (req, reply) => {
    const input = parse(CreateCampaignInput, req.body);
    await requireProject(db, req.params.projectId);
    const [row] = await db.insert(campaigns).values({ ...input, projectId: req.params.projectId }).returning();
    return reply.status(201).send({ data: row });
  });

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/campaigns", async (req) => {
    await requireProject(db, req.params.projectId);
    const rows = await db.select().from(campaigns).where(eq(campaigns.projectId, req.params.projectId)).orderBy(desc(campaigns.createdAt));
    return { data: rows };
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id", async (req) => {
    const campaign = await requireCampaign(db, req.params.id);
    return { data: { ...campaign, brief: await currentBrief(db, campaign.id) } };
  });

  app.patch<{ Params: { id: string } }>("/campaigns/:id", async (req) => {
    const input = parse(UpdateCampaignInput, req.body);
    await requireCampaign(db, req.params.id);
    const [row] = await db.update(campaigns).set({ ...input, updatedAt: new Date() }).where(eq(campaigns.id, req.params.id)).returning();
    return { data: row };
  });

  app.delete<{ Params: { id: string } }>("/campaigns/:id", async (req, reply) => {
    await requireCampaign(db, req.params.id);
    await db.delete(campaigns).where(eq(campaigns.id, req.params.id));
    return reply.status(204).send();
  });

  // Saving a brief appends a new version; earlier versions stay readable.
  app.put<{ Params: { id: string } }>("/campaigns/:id/brief", async (req) => {
    const input = parse(SaveBriefInput, req.body);
    await requireCampaign(db, req.params.id);
    const row = await db.transaction(async (tx) => {
      // Serialise concurrent saves for one campaign so versions never collide.
      await tx.execute(sql`select 1 from ${campaigns} where ${campaigns.id} = ${req.params.id} for update`);
      const [latest] = await tx
        .select({ v: sql<number>`coalesce(max(${briefs.version}), 0)::int` })
        .from(briefs)
        .where(eq(briefs.campaignId, req.params.id));
      const [inserted] = await tx
        .insert(briefs)
        .values({ campaignId: req.params.id, version: (latest?.v ?? 0) + 1, text: input.text })
        .returning();
      return inserted;
    });
    return { data: row };
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/briefs", async (req) => {
    await requireCampaign(db, req.params.id);
    const rows = await db.select().from(briefs).where(eq(briefs.campaignId, req.params.id)).orderBy(desc(briefs.version));
    return { data: rows };
  });
}
