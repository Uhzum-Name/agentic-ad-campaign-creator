import { AppError } from "@adengine/core";
import {
  MAX_IMAGE_BYTES,
  compareVariations,
  deleteImage,
  generateDirections,
  generateVariations,
  listImages,
  listVariationsDetailed,
  uploadImage,
} from "@adengine/engine";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type AppDeps, parse } from "../app.ts";

const Base64Image = z.object({ name: z.string().max(200).optional(), data: z.string().min(1).describe("Base64-encoded image file") });

export function variationRoutes(app: FastifyInstance, { db, storage }: AppDeps): void {
  const deps = { db, storage };

  // ----- image library
  app.get<{ Params: { id: string } }>("/projects/:id/images", async (req) => ({ data: await listImages(db, req.params.id) }));

  // The request body is the image file itself.
  app.post<{ Params: { id: string }; Querystring: { name?: string } }>("/projects/:id/images", { bodyLimit: MAX_IMAGE_BYTES + 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError("validation_error", "Send the image file as the request body with an image/* or application/octet-stream content type.");
    return reply.status(201).send({ data: await uploadImage(deps, { projectId: req.params.id, data: req.body, ...(req.query.name ? { name: req.query.name } : {}) }) });
  });

  // For agents, which pass files as text: the image base64-encoded in JSON.
  app.post<{ Params: { id: string } }>("/projects/:id/images/base64", { bodyLimit: Math.ceil(MAX_IMAGE_BYTES * 1.4) + 4096 }, async (req, reply) => {
    const body = parse(Base64Image, req.body);
    const data = Buffer.from(body.data.replace(/^data:[^;]+;base64,/, ""), "base64");
    return reply.status(201).send({ data: await uploadImage(deps, { projectId: req.params.id, data, ...(body.name ? { name: body.name } : {}) }) });
  });

  app.delete<{ Params: { id: string } }>("/images/:id", async (req, reply) => {
    await deleteImage(deps, req.params.id);
    return reply.status(204).send();
  });

  // ----- generation
  app.post<{ Params: { id: string } }>("/campaigns/:id/directions/batch", async (req, reply) =>
    reply.status(201).send({ data: await generateDirections(db, req.params.id, req.body) }),
  );

  app.post<{ Params: { id: string } }>("/directions/:id/variations/generate", async (req, reply) =>
    reply.status(201).send({ data: await generateVariations(db, req.params.id, req.body) }),
  );

  // ----- reading and comparing
  app.get<{ Params: { id: string }; Querystring: { directionId?: string } }>("/campaigns/:id/variations", async (req) => ({
    data: await listVariationsDetailed(db, req.query.directionId ? { directionId: req.query.directionId } : { campaignId: req.params.id }),
  }));

  app.get<{ Params: { id: string } }>("/variations/:id/changes", async (req) => {
    const [v] = await listVariationsDetailed(db, { variationId: req.params.id });
    if (!v) throw AppError.notFound("Variation", req.params.id);
    return { data: v };
  });

  app.get<{ Querystring: { ids?: string } }>("/variations/compare", async (req) => ({
    data: await compareVariations(db, (req.query.ids ?? "").split(",").filter(Boolean)),
  }));
}
