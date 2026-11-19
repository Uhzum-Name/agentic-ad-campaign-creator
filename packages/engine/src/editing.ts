import { AppError, DesignDocument, EditVariationInput, type VariationChange } from "@adengine/core";
import {
  type Db,
  agentMessages,
  campaigns,
  creativeDirections,
  designDocuments,
  variationFormats,
  variationRevisions,
  variations,
} from "@adengine/db";
import { type LayerOverrides, applyOverrides, changedDimensions, compileChanges, diffDocuments, overrideProblems, textFitWarnings } from "@adengine/design";
import { and, asc, desc, eq } from "drizzle-orm";
import { foreignAssetKeys } from "./images.ts";

/*
 * Editing one variation. Every save is a new revision; a save must name the
 * revision it started from, so an edit made elsewhere in the meantime (by the
 * agent, or in another tab) is never silently overwritten.
 */

export type RevisionRow = typeof variationRevisions.$inferSelect;
type Editor = "user" | "agent";

async function load(db: Db, variationId: string) {
  const [row] = await db
    .select({ variation: variations, design: designDocuments, direction: creativeDirections, campaign: campaigns })
    .from(variations)
    .innerJoin(creativeDirections, eq(creativeDirections.id, variations.directionId))
    .innerJoin(campaigns, eq(campaigns.id, variations.campaignId))
    .leftJoin(designDocuments, eq(designDocuments.id, variations.sourceDesignId))
    .where(eq(variations.id, variationId));
  if (!row) throw AppError.notFound("Variation", variationId);
  return row;
}

/** The variation with its source design, sizes, and version history: what the editor needs. */
export async function getVariationForEditing(db: Db, variationId: string) {
  const { variation, design, direction, campaign } = await load(db, variationId);
  const [formats, revisions] = await Promise.all([
    db.select().from(variationFormats).where(eq(variationFormats.variationId, variationId)).orderBy(asc(variationFormats.createdAt)),
    db
      .select({ revision: variationRevisions.revision, editedBy: variationRevisions.editedBy, note: variationRevisions.note, dimensions: variationRevisions.dimensions, createdAt: variationRevisions.createdAt })
      .from(variationRevisions)
      .where(eq(variationRevisions.variationId, variationId))
      .orderBy(desc(variationRevisions.revision)),
  ]);
  return {
    variation: { ...variation, formats },
    design,
    direction: { id: direction.id, name: direction.name, varyElements: direction.varyElements },
    campaign: { id: campaign.id, name: campaign.name, projectId: campaign.projectId },
    revisions,
  };
}

async function commit(
  db: Db,
  ctx: Awaited<ReturnType<typeof load>>,
  overrides: LayerOverrides,
  opts: { by: Editor; baseRevision: number; note?: string },
): Promise<{ revision: number; dimensions: string[]; warnings: string[] }> {
  const { variation, design, campaign } = ctx;
  if (!design) throw new AppError("conflict", "This variation has no source design, so it cannot be edited.");
  const problems = overrideProblems(design.document, overrides);
  if (problems.length) throw new AppError("validation_error", "The edit is not valid", problems);
  const parsed = DesignDocument.safeParse(applyOverrides(design.document, overrides));
  if (!parsed.success) {
    throw new AppError("validation_error", "The edit is not valid", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const keys = new Set<string>();
  for (const [id, patch] of Object.entries(overrides)) if (id !== "$order" && typeof patch.assetKey === "string") keys.add(patch.assetKey);
  const foreign = await foreignAssetKeys(db, campaign.projectId, [...keys]);
  if (foreign.length) throw new AppError("validation_error", `Unknown image ${foreign.join(", ")}. Use a project image or one from the project's designs.`);

  const dimensions = changedDimensions(diffDocuments(design.document, parsed.data));
  const warnings = textFitWarnings(design.document, overrides);
  const next = opts.baseRevision + 1;
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(variations)
      .set({ overrides, revision: next, dimensions, warnings, updatedAt: new Date() })
      .where(and(eq(variations.id, variation.id), eq(variations.revision, opts.baseRevision)))
      .returning({ id: variations.id });
    if (!row) return false;
    await tx.insert(variationRevisions).values({ variationId: variation.id, revision: next, overrides, editedBy: opts.by, note: opts.note ?? null, dimensions });
    return true;
  });
  if (!saved) {
    throw new AppError("conflict", `“${variation.name}” was changed since version ${opts.baseRevision} (it is now version ${(await load(db, variation.id)).variation.revision}). Reload it and make the edit again.`, {
      currentRevision: (await load(db, variation.id)).variation.revision,
    });
  }
  return { revision: next, dimensions, warnings };
}

/** Saves overrides written directly by the editor. */
export async function saveVariationOverrides(db: Db, variationId: string, input: { overrides: unknown; baseRevision: number; note?: string }) {
  if (typeof input.overrides !== "object" || input.overrides === null || Array.isArray(input.overrides)) throw new AppError("validation_error", "overrides must be an object");
  const ctx = await load(db, variationId);
  const result = await commit(db, ctx, input.overrides as LayerOverrides, { by: "user", baseRevision: input.baseRevision, ...(input.note ? { note: input.note } : {}) });
  // Recorded as the person's input, so a working agent learns its variation changed.
  await db.insert(agentMessages).values({
    campaignId: ctx.variation.campaignId,
    role: "user",
    kind: "activity",
    variationId,
    text: `Edited “${ctx.variation.name}” (version ${result.revision})${input.note ? `: ${input.note}` : ""}`,
  });
  return result;
}

/**
 * Applies described changes to a variation's current state. Unlike generation,
 * the plan's varyElements are not enforced: an individual edit is made because
 * someone asked for it.
 */
export async function editVariation(db: Db, variationId: string, input: unknown, by: Editor, baseRevision?: number) {
  const parsed = EditVariationInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError("validation_error", "The edit is not valid", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const ctx = await load(db, variationId);
  if (!ctx.design) throw new AppError("conflict", "This variation has no source design, so it cannot be edited.");
  const compiled = compileChanges(ctx.design.document, parsed.data.changes as VariationChange[], { base: ctx.variation.overrides });
  if (compiled.errors.length) throw new AppError("validation_error", "The edit could not be applied; nothing was saved.", compiled.errors);
  const result = await commit(db, ctx, compiled.overrides, { by, baseRevision: baseRevision ?? ctx.variation.revision, ...(parsed.data.note ? { note: parsed.data.note } : {}) });
  if (by === "agent") {
    await db.insert(agentMessages).values({
      campaignId: ctx.variation.campaignId,
      role: "agent",
      kind: "activity",
      variationId,
      text: `Edited “${ctx.variation.name}”${parsed.data.note ? `: ${parsed.data.note}` : ""}`,
    });
  }
  return { ...result, warnings: [...new Set([...compiled.warnings, ...result.warnings])] };
}

/** Makes an earlier version current again, as a new version (history is never rewritten). */
export async function restoreVariationRevision(db: Db, variationId: string, revision: number, baseRevision: number, by: Editor = "user") {
  const ctx = await load(db, variationId);
  const [old] = await db.select().from(variationRevisions).where(and(eq(variationRevisions.variationId, variationId), eq(variationRevisions.revision, revision)));
  if (!old) throw AppError.notFound("Version", `${revision} of ${variationId}`);
  const result = await commit(db, ctx, old.overrides, { by, baseRevision, note: `Restored version ${revision}` });
  await db.insert(agentMessages).values({
    campaignId: ctx.variation.campaignId,
    role: by,
    kind: "activity",
    variationId,
    text: `Restored “${ctx.variation.name}” to version ${revision}`,
  });
  return result;
}
