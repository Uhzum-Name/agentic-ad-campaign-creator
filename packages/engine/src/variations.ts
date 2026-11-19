import { AppError, DesignDocument, type DirectionStatus, GenerateDirectionsInput, GenerateVariationsInput, type VariationChange } from "@adengine/core";
import { type Db, agentMessages, campaigns, creativeDirections, creativePlans, designDocuments, projectImages, variationFormats, variationRevisions, variations } from "@adengine/db";
import { type LayerOverrides, applyOverrides, changedDimensions, compileChanges, diffDocuments, summarizeDesign } from "@adengine/design";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { foreignAssetKeys } from "./images.ts";

/*
 * Variation generation. The agent describes each variation as changes to a
 * source design; this module validates the whole batch, refuses it with
 * per-variation reasons if anything is wrong, and otherwise stores every
 * variation (with its sizes) in one transaction.
 */

type Issues = { variation: number; name?: string; errors: string[] }[];

function invalid(message: string, issues: { path: PropertyKey[]; message: string }[]): AppError {
  return new AppError("validation_error", message, issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })));
}

async function directionWithCampaign(db: Db, directionId: string) {
  const [row] = await db
    .select({ direction: creativeDirections, projectId: campaigns.projectId })
    .from(creativeDirections)
    .innerJoin(campaigns, eq(campaigns.id, creativeDirections.campaignId))
    .where(eq(creativeDirections.id, directionId));
  if (!row) throw AppError.notFound("Creative direction", directionId);
  return row;
}

export interface GeneratedVariation {
  id: string;
  name: string;
  dimensions: string[];
  warnings: string[];
}

export async function generateVariations(db: Db, directionId: string, input: unknown): Promise<{ directionId: string; sourceDesignId: string; sizes: { width: number; height: number }[]; variations: GeneratedVariation[] }> {
  const parsed = GenerateVariationsInput.safeParse(input);
  if (!parsed.success) throw invalid("The variations are not valid", parsed.error.issues);
  const req = parsed.data;
  const { direction, projectId } = await directionWithCampaign(db, directionId);
  if (direction.status === "rejected") throw new AppError("conflict", `"${direction.name}" was rejected. Generate variations for an approved or proposed direction.`);

  const sourceDesignId = req.sourceDesignId ?? direction.sourceDesignId;
  if (!sourceDesignId) {
    throw new AppError("validation_error", `"${direction.name}" has no source design. Pass sourceDesignId (a design in this project; see list_project_assets).`);
  }
  const [design] = await db.select().from(designDocuments).where(eq(designDocuments.id, sourceDesignId));
  if (!design || design.projectId !== projectId) throw new AppError("validation_error", `Design ${sourceDesignId} is not in this campaign's project.`);

  // Parents must be variations of this direction built on the same design.
  const parentIds = [...new Set(req.variations.map((v) => v.basedOnVariationId).filter((v): v is string => Boolean(v)))];
  const parents = parentIds.length ? await db.select().from(variations).where(inArray(variations.id, parentIds)) : [];
  const parentById = new Map(parents.map((p) => [p.id, p]));

  const issues: Issues = [];
  const compiled = req.variations.map((spec, i) => {
    const errors: string[] = [];
    let base: LayerOverrides | undefined;
    if (spec.basedOnVariationId) {
      const parent = parentById.get(spec.basedOnVariationId);
      if (!parent || parent.directionId !== directionId) errors.push(`basedOnVariationId ${spec.basedOnVariationId} is not a variation of this direction.`);
      else if (parent.sourceDesignId !== sourceDesignId) errors.push(`basedOnVariationId ${spec.basedOnVariationId} is built on a different design.`);
      else base = parent.overrides;
    }
    const result = compileChanges(design.document, spec.changes as VariationChange[], { ...(base ? { base } : {}), varyElements: direction.varyElements });
    errors.push(...result.errors);
    if (result.outOfPlan.length && !spec.outOfPlanReason) {
      errors.push(`It changes ${result.outOfPlan.join(", ")}, which this direction's plan does not vary (${direction.varyElements?.join(", ")}). Remove those changes or give outOfPlanReason.`);
    }
    if (errors.length === 0) {
      const check = DesignDocument.safeParse(applyOverrides(design.document, result.overrides));
      if (!check.success) errors.push(`The result is not a valid design: ${check.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
    }
    if (errors.length) issues.push({ variation: i + 1, ...(spec.name ? { name: spec.name } : {}), errors });
    return { spec, result };
  });

  const keys = [...new Set(compiled.flatMap((c) => c.result.assetKeys))];
  const foreign = await foreignAssetKeys(db, projectId, keys);
  if (foreign.length) {
    compiled.forEach((c, i) => {
      const bad = c.result.assetKeys.filter((k) => foreign.includes(k));
      if (bad.length) {
        const entry = issues.find((x) => x.variation === i + 1) ?? issues[issues.push({ variation: i + 1, errors: [] }) - 1]!;
        entry.errors.push(`Unknown image ${bad.join(", ")}. Use a project image (list_project_assets) or one from the project's designs.`);
      }
    });
  }
  if (issues.length) {
    issues.sort((a, b) => a.variation - b.variation);
    throw new AppError("validation_error", `${issues.length} of ${req.variations.length} variation${req.variations.length === 1 ? "" : "s"} could not be built; nothing was saved. Fix them and send the batch again.`, issues);
  }

  let sizes = req.sizes;
  if (!sizes && direction.planId) {
    const [plan] = await db.select({ plan: creativePlans.plan }).from(creativePlans).where(eq(creativePlans.id, direction.planId));
    sizes = plan?.plan.formats;
  }
  sizes ??= [{ width: design.width, height: design.height }];
  const uniqueSizes = [...new Map(sizes.map((s) => [`${s.width}x${s.height}`, s])).values()];

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from ${creativeDirections} where ${creativeDirections.id} = ${directionId} for update`);
    const [pos] = await tx.select({ p: sql<number>`coalesce(max(${variations.position}), -1)::int` }).from(variations).where(eq(variations.directionId, directionId));
    const start = (pos?.p ?? -1) + 1;
    const rows = await tx
      .insert(variations)
      .values(
        compiled.map(({ spec, result }, i) => ({
          campaignId: direction.campaignId,
          directionId,
          sourceDesignId,
          parentVariationId: spec.basedOnVariationId ?? null,
          name: spec.name ?? `${direction.name} ${start + i + 1}`,
          overrides: result.overrides,
          changes: spec.changes,
          dimensions: result.dimensions,
          warnings: result.warnings,
          rationale: { summary: spec.rationale, ...(spec.outOfPlanReason ? { outOfPlanReason: spec.outOfPlanReason, outOfPlan: result.outOfPlan } : {}) },
          status: "ready" as const,
          position: start + i,
        })),
      )
      .returning({ id: variations.id, name: variations.name, dimensions: variations.dimensions, warnings: variations.warnings, overrides: variations.overrides });
    await tx.insert(variationRevisions).values(
      rows.map((r, i) => ({ variationId: r.id, revision: 1, overrides: r.overrides, editedBy: "agent" as const, note: compiled[i]!.spec.rationale, dimensions: r.dimensions })),
    );
    await tx.insert(variationFormats).values(rows.flatMap((r) => uniqueSizes.map((s) => ({ variationId: r.id, width: s.width, height: s.height, label: s.label ?? null }))));
    return rows;
  });

  await db.insert(agentMessages).values({
    campaignId: direction.campaignId,
    role: "agent",
    kind: "activity",
    text: `Created ${created.length} variation${created.length === 1 ? "" : "s"} in “${direction.name}”`,
  });
  return {
    directionId,
    sourceDesignId,
    sizes: uniqueSizes.map(({ width, height }) => ({ width, height })),
    variations: created.map((r) => ({ id: r.id, name: r.name, dimensions: r.dimensions ?? [], warnings: r.warnings ?? [] })),
  };
}

/** Directions proposed outside a plan. They start as "proposed" for the person to approve. */
export async function generateDirections(db: Db, campaignId: string, input: unknown) {
  const parsed = GenerateDirectionsInput.safeParse(input);
  if (!parsed.success) throw invalid("The directions are not valid", parsed.error.issues);
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw AppError.notFound("Campaign", campaignId);
  const designIds = [...new Set(parsed.data.directions.map((d) => d.sourceDesignId).filter((v): v is string => Boolean(v)))];
  if (designIds.length) {
    const found = await db.select({ id: designDocuments.id }).from(designDocuments).where(and(inArray(designDocuments.id, designIds), eq(designDocuments.projectId, campaign.projectId)));
    const missing = designIds.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw new AppError("validation_error", `These designs are not in this campaign's project: ${missing.join(", ")}`);
  }
  const rows = await db.transaction(async (tx) => {
    const [pos] = await tx.select({ p: sql<number>`coalesce(max(${creativeDirections.position}), -1)::int` }).from(creativeDirections).where(eq(creativeDirections.campaignId, campaignId));
    return tx
      .insert(creativeDirections)
      .values(
        parsed.data.directions.map((d, i) => ({
          campaignId,
          name: d.name,
          concept: d.concept,
          messagingAngle: d.messagingAngle,
          visualTreatment: d.visualTreatment ?? null,
          sourceDesignId: d.sourceDesignId ?? null,
          plannedVariations: d.plannedVariations ?? null,
          varyElements: d.varyElements ?? null,
          status: "proposed" as DirectionStatus,
          position: (pos?.p ?? -1) + 1 + i,
        })),
      )
      .returning();
  });
  await db.insert(agentMessages).values({ campaignId, role: "agent", kind: "activity", text: `Proposed ${rows.length} new direction${rows.length === 1 ? "" : "s"}: ${rows.map((r) => r.name).join(", ")}` });
  return rows;
}

/** Library names for uploaded images, so differences read "boot.png" rather than a storage key. */
async function imageNames(db: Db, projectIds: string[]): Promise<(key: string) => string | undefined> {
  if (projectIds.length === 0) return () => undefined;
  const rows = await db.select({ key: projectImages.assetKey, name: projectImages.name }).from(projectImages).where(inArray(projectImages.projectId, projectIds));
  const map = new Map(rows.map((r) => [r.key, r.name]));
  return (key) => map.get(key);
}

async function loadVariations(db: Db, where: ReturnType<typeof eq>) {
  const rows = await db.select().from(variations).where(where).orderBy(asc(variations.position));
  const designIds = [...new Set(rows.map((r) => r.sourceDesignId).filter((v): v is string => Boolean(v)))];
  const designs = designIds.length ? await db.select().from(designDocuments).where(inArray(designDocuments.id, designIds)) : [];
  return { rows, designs: new Map(designs.map((d) => [d.id, d])) };
}

/** Variations with their resulting text and what changed from the source, so an agent can see what exists. */
export async function listVariationsDetailed(db: Db, scope: { campaignId?: string; directionId?: string; variationId?: string }) {
  if (!scope.campaignId && !scope.directionId && !scope.variationId) throw new AppError("validation_error", "Give campaignId, directionId or variationId");
  const where = scope.variationId
    ? eq(variations.id, scope.variationId)
    : scope.directionId
      ? eq(variations.directionId, scope.directionId)
      : eq(variations.campaignId, scope.campaignId!);
  const { rows, designs } = await loadVariations(db, where);
  const assetName = await imageNames(db, [...new Set([...designs.values()].map((d) => d.projectId))]);
  return rows.map((v) => {
    const design = v.sourceDesignId ? designs.get(v.sourceDesignId) : undefined;
    const doc = design ? applyOverrides(design.document, v.overrides) : undefined;
    const diffs = design && doc ? diffDocuments(design.document, doc, { assetName }) : [];
    return {
      id: v.id,
      name: v.name,
      directionId: v.directionId,
      status: v.status,
      sourceDesignId: v.sourceDesignId,
      parentVariationId: v.parentVariationId,
      rationale: v.rationale,
      dimensions: changedDimensions(diffs),
      warnings: v.warnings ?? [],
      texts: doc ? summarizeDesign(doc).texts.map((t) => ({ id: t.id, role: t.role, text: t.text })) : [],
      changes: diffs,
    };
  });
}

/** What changed in each variation from its source, and how each differs from the first one given. */
export async function compareVariations(db: Db, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length < 2 || unique.length > 6) throw new AppError("validation_error", "Compare between 2 and 6 variations");
  const rows = await db.select().from(variations).where(inArray(variations.id, unique));
  const missing = unique.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw AppError.notFound("Variation", missing.join(", "));
  const ordered = unique.map((id) => rows.find((r) => r.id === id)!);
  const designIds = [...new Set(ordered.map((r) => r.sourceDesignId).filter((v): v is string => Boolean(v)))];
  const designs = new Map((designIds.length ? await db.select().from(designDocuments).where(inArray(designDocuments.id, designIds)) : []).map((d) => [d.id, d]));
  const docs = ordered.map((v) => {
    const d = v.sourceDesignId ? designs.get(v.sourceDesignId) : undefined;
    return d ? applyOverrides(d.document, v.overrides) : undefined;
  });
  const first = ordered[0]!;
  const assetName = await imageNames(db, [...new Set([...designs.values()].map((d) => d.projectId))]);
  return {
    variations: ordered.map((v, i) => {
      const design = v.sourceDesignId ? designs.get(v.sourceDesignId) : undefined;
      const fromSource = design && docs[i] ? diffDocuments(design.document, docs[i]!, { assetName }) : [];
      const comparable = i > 0 && docs[0] && docs[i] && v.sourceDesignId === first.sourceDesignId;
      return {
        id: v.id,
        name: v.name,
        status: v.status,
        sourceDesignId: v.sourceDesignId,
        rationale: v.rationale,
        dimensions: changedDimensions(fromSource),
        changesFromSource: fromSource,
        ...(i > 0 ? { differencesFromFirst: comparable ? diffDocuments(docs[0]!, docs[i]!, { assetName }) : null } : {}),
      };
    }),
  };
}
