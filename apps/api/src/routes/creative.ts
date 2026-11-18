import {
  AppError,
  CreateDirectionInput,
  CreateVariationInput,
  PostMessageInput,
  UpdateDirectionInput,
  UpdateVariationInput,
} from "@adengine/core";
import { type Db, agentMessages, creativeDirections, designDocuments, variationFormats, variations } from "@adengine/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { type AppDeps, parse } from "../app.ts";
import { currentBrief, requireCampaign } from "./campaigns.ts";

async function requireDirection(db: Db, id: string) {
  const [row] = await db.select().from(creativeDirections).where(eq(creativeDirections.id, id));
  if (!row) throw AppError.notFound("Creative direction", id);
  return row;
}

async function requireVariation(db: Db, id: string) {
  const [row] = await db.select().from(variations).where(eq(variations.id, id));
  if (!row) throw AppError.notFound("Variation", id);
  return row;
}

async function variationWithFormats(db: Db, id: string) {
  const variation = await requireVariation(db, id);
  const formats = await db.select().from(variationFormats).where(eq(variationFormats.variationId, id)).orderBy(asc(variationFormats.createdAt));
  return { ...variation, formats };
}

export function creativeRoutes(app: FastifyInstance, { db }: AppDeps): void {
  /** Everything the variation grid needs, in one read. */
  app.get<{ Params: { id: string } }>("/campaigns/:id/workspace", async (req) => {
    const campaign = await requireCampaign(db, req.params.id);
    const [brief, directions, allVariations] = await Promise.all([
      currentBrief(db, campaign.id),
      db.select().from(creativeDirections).where(eq(creativeDirections.campaignId, campaign.id)).orderBy(asc(creativeDirections.position), asc(creativeDirections.createdAt)),
      db.select().from(variations).where(eq(variations.campaignId, campaign.id)).orderBy(asc(variations.position), asc(variations.createdAt)),
    ]);
    const formats = allVariations.length
      ? await db.select().from(variationFormats).where(inArray(variationFormats.variationId, allVariations.map((v) => v.id))).orderBy(asc(variationFormats.createdAt))
      : [];
    const designIds = [...new Set(allVariations.map((v) => v.sourceDesignId).filter((id): id is string => id !== null))];
    const designs = designIds.length
      ? await db
          .select({ id: designDocuments.id, name: designDocuments.name, width: designDocuments.width, height: designDocuments.height, document: designDocuments.document })
          .from(designDocuments)
          .where(inArray(designDocuments.id, designIds))
      : [];
    return {
      data: {
        campaign,
        brief,
        /** Source designs referenced by the variations, keyed by id, so the grid can render them. */
        designs: Object.fromEntries(designs.map((d) => [d.id, d])),
        directions: directions.map((d) => ({
          ...d,
          variations: allVariations
            .filter((v) => v.directionId === d.id)
            .map((v) => ({ ...v, formats: formats.filter((f) => f.variationId === v.id) })),
        })),
      },
    };
  });

  // ----- creative directions -----
  app.post<{ Params: { id: string } }>("/campaigns/:id/directions", async (req, reply) => {
    const input = parse(CreateDirectionInput, req.body);
    await requireCampaign(db, req.params.id);
    const [row] = await db
      .insert(creativeDirections)
      .values({
        ...input,
        campaignId: req.params.id,
        position: sql`(select coalesce(max(position), -1) + 1 from creative_directions where campaign_id = ${req.params.id})`,
      })
      .returning();
    return reply.status(201).send({ data: row });
  });

  app.patch<{ Params: { id: string } }>("/directions/:id", async (req) => {
    const input = parse(UpdateDirectionInput, req.body);
    await requireDirection(db, req.params.id);
    const [row] = await db.update(creativeDirections).set({ ...input, updatedAt: new Date() }).where(eq(creativeDirections.id, req.params.id)).returning();
    return { data: row };
  });

  app.delete<{ Params: { id: string } }>("/directions/:id", async (req, reply) => {
    await requireDirection(db, req.params.id);
    await db.delete(creativeDirections).where(eq(creativeDirections.id, req.params.id));
    return reply.status(204).send();
  });

  // ----- variations -----
  app.post<{ Params: { id: string } }>("/directions/:id/variations", async (req, reply) => {
    const { sizes, ...input } = parse(CreateVariationInput, req.body);
    const direction = await requireDirection(db, req.params.id);
    if (input.sourceDesignId) {
      const [design] = await db.select({ projectId: designDocuments.projectId }).from(designDocuments).where(eq(designDocuments.id, input.sourceDesignId));
      if (!design) throw AppError.notFound("Design document", input.sourceDesignId);
      const campaign = await requireCampaign(db, direction.campaignId);
      if (design.projectId !== campaign.projectId) {
        throw new AppError("validation_error", "The source design belongs to a different project than this campaign");
      }
    }
    const unique = new Set(sizes?.map((s) => `${s.width}x${s.height}`));
    if (sizes && unique.size !== sizes.length) throw new AppError("validation_error", "sizes contains the same dimensions more than once");

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(variations)
        .values({
          ...input,
          directionId: direction.id,
          campaignId: direction.campaignId,
          position: sql`(select coalesce(max(position), -1) + 1 from variations where direction_id = ${direction.id})`,
        })
        .returning({ id: variations.id });
      if (!row) throw new Error("Failed to insert variation");
      if (sizes?.length) await tx.insert(variationFormats).values(sizes.map((s) => ({ ...s, variationId: row.id })));
      return row.id;
    });
    return reply.status(201).send({ data: await variationWithFormats(db, id) });
  });

  app.patch<{ Params: { id: string } }>("/variations/:id", async (req) => {
    const input = parse(UpdateVariationInput, req.body);
    await requireVariation(db, req.params.id);
    await db.update(variations).set({ ...input, updatedAt: new Date() }).where(eq(variations.id, req.params.id));
    return { data: await variationWithFormats(db, req.params.id) };
  });

  app.delete<{ Params: { id: string } }>("/variations/:id", async (req, reply) => {
    await requireVariation(db, req.params.id);
    await db.delete(variations).where(eq(variations.id, req.params.id));
    return reply.status(204).send();
  });

  // ----- campaign thread (agent panel) -----
  app.get<{ Params: { id: string }; Querystring: { pending?: string } }>("/campaigns/:id/messages", async (req) => {
    await requireCampaign(db, req.params.id);
    const onlyPending = req.query.pending === "true";
    const rows = await db
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.campaignId, req.params.id),
          onlyPending ? and(eq(agentMessages.role, "user"), isNull(agentMessages.acknowledgedAt)) : undefined,
        ),
      )
      .orderBy(asc(agentMessages.createdAt), asc(agentMessages.id))
      .limit(500);
    return { data: rows };
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/messages", async (req, reply) => {
    const input = parse(PostMessageInput, req.body);
    if (input.role === "user" && input.kind !== "message") {
      throw new AppError("validation_error", 'Only agent entries may use kind "activity"');
    }
    await requireCampaign(db, req.params.id);
    const [row] = await db.insert(agentMessages).values({ ...input, campaignId: req.params.id }).returning();
    return reply.status(201).send({ data: row });
  });

  /** An agent marks a user's direction as picked up. Idempotent. */
  app.post<{ Params: { id: string } }>("/messages/:id/acknowledge", async (req) => {
    const [existing] = await db.select().from(agentMessages).where(eq(agentMessages.id, req.params.id));
    if (!existing) throw AppError.notFound("Message", req.params.id);
    if (existing.role !== "user") throw new AppError("validation_error", "Only user messages can be acknowledged");
    if (existing.acknowledgedAt) return { data: existing };
    const [row] = await db.update(agentMessages).set({ acknowledgedAt: new Date() }).where(eq(agentMessages.id, req.params.id)).returning();
    return { data: row };
  });
}
