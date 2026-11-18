import { AppError, SEMANTIC_ROLES } from "@adengine/core";
import { campaigns, creativeDirections, designDocuments, variations } from "@adengine/db";
import { findLayers, getLayer, listLayers, summarizeDesign } from "@adengine/design";
import { MAX_FONT_BYTES, createDesign, deleteFont, getDesign, importFixture, listDesigns, listFixtures, listFonts, uploadFont } from "@adengine/engine";
import { parseFigmaUrl } from "@adengine/figma";
import { asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type AppDeps, parse } from "../app.ts";

const CreateDesignBody = z.object({ name: z.string().trim().min(1).max(200), document: z.unknown() });
const FromFixtureBody = z.object({ fixture: z.string().min(1) });
const ImportFigmaBody = z
  .object({
    url: z.string().optional().describe("A Figma link copied with 'Copy link to selection'"),
    fileKey: z.string().optional(),
    nodeId: z.string().optional(),
    name: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.url || (v.fileKey && v.nodeId), { message: "Provide either url, or fileKey and nodeId" });
const LayerQuery = z.object({
  type: z.enum(["text", "image", "shape", "group"]).optional(),
  role: z.enum(SEMANTIC_ROLES).optional(),
  name: z.string().optional(),
});

export function designRoutes(app: FastifyInstance, { db, storage, jobs }: AppDeps): void {
  const deps = { db, storage };

  app.get("/design-fixtures", async () => ({ data: listFixtures() }));

  app.get<{ Params: { id: string } }>("/projects/:id/designs", async (req) => {
    const designs = await listDesigns(db, req.params.id);
    const counts = await db
      .select({ id: variations.sourceDesignId, n: sql<number>`count(*)::int` })
      .from(variations)
      .innerJoin(designDocuments, eq(designDocuments.id, variations.sourceDesignId))
      .where(eq(designDocuments.projectId, req.params.id))
      .groupBy(variations.sourceDesignId);
    const byId = new Map(counts.map((c) => [c.id, c.n]));
    return { data: designs.map((d) => ({ ...d, usageCount: byId.get(d.id) ?? 0 })) };
  });

  app.post<{ Params: { id: string } }>("/projects/:id/designs", async (req, reply) => {
    const body = parse(CreateDesignBody, req.body);
    const design = await createDesign(deps, { projectId: req.params.id, name: body.name, document: body.document });
    return reply.status(201).send({ data: design });
  });

  app.post<{ Params: { id: string } }>("/projects/:id/designs/from-fixture", async (req, reply) => {
    const body = parse(FromFixtureBody, req.body);
    return reply.status(201).send({ data: await importFixture(deps, { projectId: req.params.id, fixture: body.fixture }) });
  });

  // Long-running (network calls to Figma): returns a job to poll.
  app.post<{ Params: { id: string } }>("/projects/:id/designs/import-figma", async (req, reply) => {
    const body = parse(ImportFigmaBody, req.body);
    const target = body.url ? parseFigmaUrl(body.url) : { fileKey: body.fileKey!, nodeId: body.nodeId };
    const nodeId = target.nodeId ?? body.nodeId;
    if (!nodeId) {
      throw new AppError("validation_error", "The link does not point at a frame. In Figma, select the frame, right-click, choose Copy/Paste as → Copy link to selection, and paste that link.");
    }
    await listDesigns(db, req.params.id); // 404s for an unknown project before any work is queued
    const job = await jobs.submit(
      "design.import_figma",
      { projectId: req.params.id, fileKey: target.fileKey, nodeId, ...(body.name ? { name: body.name } : {}) },
      { projectId: req.params.id },
    );
    return reply.status(202).send({ data: job });
  });

  app.get<{ Params: { id: string } }>("/designs/:id", async (req) => {
    const design = await getDesign(db, req.params.id);
    return { data: { ...design, summary: summarizeDesign(design.document) } };
  });

  /** The variations built from this design, with their campaign and direction. */
  app.get<{ Params: { id: string } }>("/designs/:id/usage", async (req) => {
    await getDesign(db, req.params.id);
    const rows = await db
      .select({
        variationId: variations.id,
        variationName: variations.name,
        status: variations.status,
        directionId: creativeDirections.id,
        directionName: creativeDirections.name,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
      })
      .from(variations)
      .innerJoin(creativeDirections, eq(creativeDirections.id, variations.directionId))
      .innerJoin(campaigns, eq(campaigns.id, variations.campaignId))
      .where(eq(variations.sourceDesignId, req.params.id))
      .orderBy(asc(campaigns.name), asc(creativeDirections.position), asc(variations.position));
    return { data: rows };
  });

  app.get<{ Params: { id: string } }>("/designs/:id/layers", async (req) => {
    const filter = parse(LayerQuery, req.query);
    const design = await getDesign(db, req.params.id);
    const hasFilter = Object.values(filter).some((v) => v !== undefined);
    return { data: hasFilter ? findLayers(design.document, filter) : listLayers(design.document) };
  });

  app.get<{ Params: { id: string; layerId: string } }>("/designs/:id/layers/:layerId", async (req) => {
    const design = await getDesign(db, req.params.id);
    const layer = getLayer(design.document, req.params.layerId);
    if (!layer) throw AppError.notFound("Layer", req.params.layerId);
    const info = listLayers(design.document).find((l) => l.id === layer.id);
    return { data: { ...info, layer } };
  });

  app.delete<{ Params: { id: string } }>("/designs/:id", async (req, reply) => {
    await getDesign(db, req.params.id);
    const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(variations).where(eq(variations.sourceDesignId, req.params.id));
    if (used && used.n > 0) {
      throw new AppError("conflict", `This design is the source of ${used.n} variation${used.n === 1 ? "" : "s"} and cannot be deleted.`);
    }
    await db.delete(designDocuments).where(eq(designDocuments.id, req.params.id));
    return reply.status(204).send();
  });

  // ----- brand fonts -----
  app.get<{ Params: { id: string } }>("/projects/:id/fonts", async (req) => ({ data: await listFonts(db, req.params.id) }));

  // The request body is the font file itself (not JSON). Family, weight and style are read from the file.
  app.post<{ Params: { id: string }; Querystring: { fileName?: string; family?: string } }>(
    "/projects/:id/fonts",
    { bodyLimit: MAX_FONT_BYTES + 1024 },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError("validation_error", "Send the font file as the request body with Content-Type application/octet-stream (or font/woff2, font/ttf, ...).");
      }
      const result = await uploadFont(deps, { projectId: req.params.id, data: req.body, fileName: req.query.fileName, family: req.query.family });
      return reply.status(result.replaced ? 200 : 201).send({ data: { ...result.font, replaced: result.replaced } });
    },
  );

  app.delete<{ Params: { id: string } }>("/fonts/:id", async (req, reply) => {
    await deleteFont(deps, req.params.id);
    return reply.status(204).send();
  });

  // Stored files (design images, reference renders). Keys are unguessable design ids.
  app.get<{ Params: { "*": string } }>("/assets/*", async (req, reply) => {
    const object = await storage.read(req.params["*"]);
    return reply
      .header("content-type", object.contentType)
      .header("cache-control", "public, max-age=3600")
      // Uploaded SVG must never run script or load anything when opened directly.
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header("x-content-type-options", "nosniff")
      .send(object.data);
  });
}
