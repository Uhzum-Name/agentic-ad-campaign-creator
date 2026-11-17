import { z } from "zod";

/**
 * The internal creative document: a tree of layers with absolute geometry
 * relative to their parent. It is source-agnostic — Figma is one importer —
 * and is the single representation the agent, editor, layout, animation and
 * render systems all read and modify.
 *
 * Milestone 1 fixes the shape; milestone 3 adds importers and inspection.
 */

/** What a layer *means* in the ad. Drives variation, resizing and animation targeting. */
export const SEMANTIC_ROLES = [
  "background",
  "logo",
  "headline",
  "subheadline",
  "body",
  "offer",
  "cta",
  "product",
  "image",
  "legal",
  "decoration",
] as const;
export const SemanticRole = z.enum(SEMANTIC_ROLES);
export type SemanticRole = z.infer<typeof SemanticRole>;

const Color = z.string().describe("CSS color, e.g. #1a2b3c or rgba(0,0,0,0.5)");

export const Fill = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: Color }),
  z.object({
    type: z.literal("linear-gradient"),
    angle: z.number(),
    stops: z.array(z.object({ offset: z.number().min(0).max(1), color: Color })).min(2),
  }),
]);
export type Fill = z.infer<typeof Fill>;

const LayerBase = z.object({
  id: z.string(),
  name: z.string(),
  role: SemanticRole.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  /** Id of the node in the originating tool (e.g. a Figma node id), if any. */
  sourceRef: z.string().optional(),
});

export const TextStyle = z.object({
  fontFamily: z.string(),
  fontWeight: z.number().default(400),
  fontSize: z.number().positive(),
  lineHeight: z.number().positive().optional().describe("Unitless multiplier of fontSize"),
  letterSpacing: z.number().default(0).describe("px"),
  color: Color,
  align: z.enum(["left", "center", "right"]).default("left"),
  verticalAlign: z.enum(["top", "middle", "bottom"]).default("top"),
  italic: z.boolean().default(false),
  transform: z.enum(["none", "uppercase", "lowercase"]).default("none"),
});
export type TextStyle = z.infer<typeof TextStyle>;

export const TextLayer = LayerBase.extend({
  type: z.literal("text"),
  text: z.string(),
  style: TextStyle,
});
export type TextLayer = z.infer<typeof TextLayer>;

export const ImageLayer = LayerBase.extend({
  type: z.literal("image"),
  /** Storage key of the bitmap/vector asset. */
  assetKey: z.string(),
  fit: z.enum(["cover", "contain", "fill"]).default("cover"),
  /** Focal point (0..1) kept in view when the image is cropped during resizing. */
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  cornerRadius: z.number().nonnegative().default(0),
});
export type ImageLayer = z.infer<typeof ImageLayer>;

export const ShapeLayer = LayerBase.extend({
  type: z.literal("shape"),
  shape: z.enum(["rectangle", "ellipse"]),
  fill: Fill.optional(),
  stroke: z.object({ color: Color, width: z.number().nonnegative() }).optional(),
  cornerRadius: z.number().nonnegative().default(0),
});
export type ShapeLayer = z.infer<typeof ShapeLayer>;

export type GroupLayer = z.infer<typeof LayerBase> & {
  type: "group";
  clip: boolean;
  fill?: Fill;
  cornerRadius: number;
  children: Layer[];
};
export type Layer = TextLayer | ImageLayer | ShapeLayer | GroupLayer;

export const GroupLayer: z.ZodType<GroupLayer> = LayerBase.extend({
  type: z.literal("group"),
  clip: z.boolean().default(false),
  fill: Fill.optional(),
  cornerRadius: z.number().nonnegative().default(0),
  get children() {
    return z.array(Layer);
  },
}) as unknown as z.ZodType<GroupLayer>;

export const Layer: z.ZodType<Layer> = z.lazy(() =>
  z.union([TextLayer, ImageLayer, ShapeLayer, GroupLayer]),
) as z.ZodType<Layer>;

export const DesignDocument = z.object({
  schemaVersion: z.literal(1),
  width: z.number().positive(),
  height: z.number().positive(),
  background: Fill.optional(),
  layers: z.array(Layer),
});
export type DesignDocument = z.infer<typeof DesignDocument>;

/** Where a design came from. The original is never modified by our edits. */
export const DesignSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixture"), name: z.string() }),
  z.object({ kind: z.literal("figma"), fileKey: z.string(), nodeId: z.string(), version: z.string().optional() }),
  z.object({ kind: z.literal("manual") }),
]);
export type DesignSource = z.infer<typeof DesignSource>;
