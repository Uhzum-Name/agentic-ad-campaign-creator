// Browser-safe: imported by the web app via "@adengine/core/variations".
import { z } from "zod";
import { Fill, SEMANTIC_ROLES } from "./design.ts";
import { VARY_ELEMENTS } from "./planning.ts";

/*
 * A variation is described by the agent as a list of precise changes to its
 * source design. The engine validates each change against the design and
 * compiles the list into layer overrides; the source is never modified.
 */

/** A layer, by id, or by role (resolved to the single layer with that role). */
export const LayerTarget = z.union([
  z.object({ layerId: z.string().min(1) }),
  z.object({ role: z.enum(SEMANTIC_ROLES) }),
]);
export type LayerTarget = z.infer<typeof LayerTarget>;

/** Text style properties that can change. Written out so no defaults apply. */
export const TextStylePatch = z
  .object({
    fontFamily: z.string().min(1),
    fontWeight: z.number().int().min(100).max(900),
    fontSize: z.number().positive().max(500),
    lineHeight: z.number().positive().max(5),
    letterSpacing: z.number().min(-20).max(50),
    color: z.string().min(1),
    align: z.enum(["left", "center", "right"]),
    verticalAlign: z.enum(["top", "middle", "bottom"]),
    italic: z.boolean(),
    underline: z.boolean(),
    transform: z.enum(["none", "uppercase", "lowercase"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Give at least one style property");

export const VariationChange = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_text"), target: LayerTarget, text: z.string().max(2000) }),
  z.object({ op: z.literal("set_text_style"), target: LayerTarget, style: TextStylePatch }),
  z.object({
    op: z.literal("replace_image"),
    target: LayerTarget,
    assetKey: z.string().min(1).describe("A project image (see list_project_assets) or an image already used in the project's designs"),
    fit: z.enum(["cover", "contain", "fill"]).optional(),
    focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  }),
  z.object({ op: z.literal("set_fill"), target: LayerTarget, fill: Fill }),
  z.object({
    op: z.literal("set_geometry"),
    target: LayerTarget,
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  }),
  z.object({ op: z.literal("set_visibility"), target: LayerTarget, visible: z.boolean() }),
]);
export type VariationChange = z.infer<typeof VariationChange>;

export const VariationSpec = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  /** Start from another variation of the same direction instead of the plain source design. */
  basedOnVariationId: z.string().optional(),
  changes: z.array(VariationChange).min(1).max(100),
  rationale: z.string().trim().min(1).max(2000).describe("Why this variation: its angle and what it tests"),
  /** Required to change an element the direction's plan does not list in varyElements. */
  outOfPlanReason: z.string().trim().min(1).max(1000).optional(),
});
export type VariationSpec = z.infer<typeof VariationSpec>;

export const GenerateVariationsInput = z.object({
  variations: z.array(VariationSpec).min(1).max(50),
  /** The design to build from. Defaults to the direction's source design from its plan. */
  sourceDesignId: z.string().optional(),
  /** Sizes to produce. Defaults to the approved plan's formats, else the source design's size. */
  sizes: z.array(z.object({ width: z.number().int().min(1).max(10_000), height: z.number().int().min(1).max(10_000), label: z.string().max(100).optional() })).max(30).optional(),
});
export type GenerateVariationsInput = z.infer<typeof GenerateVariationsInput>;

/** The parts of an ad a change can touch, matching the plan's varyElements plus a few the plan does not vary. */
export const CHANGE_DIMENSIONS = [...VARY_ELEMENTS, "logo", "legal", "background"] as const;
export type ChangeDimension = (typeof CHANGE_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<ChangeDimension, string> = {
  headline: "Headline",
  subheadline: "Subheadline",
  body: "Body copy",
  image: "Image",
  offer: "Offer",
  cta: "CTA",
  layout: "Layout",
  messaging: "Messaging",
  visual_treatment: "Visual treatment",
  animation: "Animation",
  logo: "Logo",
  legal: "Legal",
  background: "Background",
};

export const DirectionSpec = z.object({
  name: z.string().trim().min(1).max(200),
  concept: z.string().trim().min(1).max(2000),
  messagingAngle: z.string().trim().min(1).max(1000),
  visualTreatment: z.string().trim().max(1000).optional(),
  sourceDesignId: z.string().optional(),
  plannedVariations: z.number().int().min(1).max(50).optional(),
  varyElements: z.array(z.enum(VARY_ELEMENTS)).min(1).optional(),
});
export const GenerateDirectionsInput = z.object({ directions: z.array(DirectionSpec).min(1).max(20) });
