import type { DesignDocument, Fill, Layer, SemanticRole } from "@adengine/core";
import type { Box, FigmaColor, FigmaNode, FigmaPaint } from "./client.ts";

/*
 * Converts a Figma node tree into our design document. Pure: no network.
 *
 * Text, images, rectangles, ellipses and containers become live, editable
 * layers. Anything our renderer cannot reproduce faithfully (vectors, rotated
 * nodes, masks, effects on shapes, exotic fills) is marked to be rasterised by
 * Figma and placed as an image layer, and the report says so.
 */

export interface RasterRequest {
  nodeId: string;
  format: "png" | "svg";
  assetKey: string;
}
export interface ImageFillRequest {
  imageRef: string;
  assetKey: string;
}
export interface ConversionReport {
  nodes: number;
  layers: { text: number; image: number; shape: number; group: number };
  rasterized: { nodeId: string; name: string; reason: string }[];
  skipped: { nodeId: string; name: string; reason: string }[];
  warnings: string[];
  inferredRoles: Record<string, SemanticRole>;
}
export interface ConversionResult {
  document: DesignDocument;
  imageFills: ImageFillRequest[];
  rasters: RasterRequest[];
  report: ConversionReport;
}

const CONTAINERS = new Set(["FRAME", "GROUP", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION"]);
const VECTORS = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "REGULAR_POLYGON"]);

export const layerIdFor = (figmaId: string) => `fg_${figmaId.replace(/[^a-zA-Z0-9]/g, "_")}`;

function rgba(c: FigmaColor, opacity = 1): string {
  const a = Math.round((c.a ?? 1) * opacity * 1000) / 1000;
  const ch = (v: number) => Math.round(v * 255);
  if (a >= 1) return `#${[c.r, c.g, c.b].map((v) => ch(v).toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${ch(c.r)},${ch(c.g)},${ch(c.b)},${a})`;
}

const visiblePaints = (paints: FigmaPaint[] | undefined) => (paints ?? []).filter((p) => p.visible !== false && (p.opacity ?? 1) > 0);

/** A solid or linear-gradient paint as our Fill, or undefined if it is another kind. */
function toFill(paint: FigmaPaint, box: Box): Fill | undefined {
  if (paint.type === "SOLID" && paint.color) return { type: "solid", color: rgba(paint.color, paint.opacity ?? 1) };
  if (paint.type === "GRADIENT_LINEAR" && paint.gradientStops && paint.gradientHandlePositions && paint.gradientHandlePositions.length >= 2) {
    const [start, end] = paint.gradientHandlePositions as [{ x: number; y: number }, { x: number; y: number }];
    const dx = (end.x - start.x) * box.width;
    const dy = (end.y - start.y) * box.height;
    // CSS: 0deg points up, angles grow clockwise.
    const angle = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);
    return {
      type: "linear-gradient",
      angle,
      stops: paint.gradientStops.map((s) => ({ offset: Math.min(1, Math.max(0, s.position)), color: rgba(s.color, paint.opacity ?? 1) })),
    };
  }
  return undefined;
}

const ROLE_PATTERNS: [RegExp, SemanticRole][] = [
  [/\b(logo|brand ?mark|wordmark)\b/, "logo"],
  [/\b(cta|button|btn|call to action)\b/, "cta"],
  [/\b(sub ?head(line|ing)?|sub ?title|tagline|h2|kicker)\b/, "subheadline"],
  [/\b(headline|heading|title|h1)\b/, "headline"],
  [/\b(legal|disclaimer|terms|t&cs?|small ?print)\b/, "legal"],
  [/\b(offer|price|discount|badge|promo|sale)\b/, "offer"],
  [/\b(product|hero|pack ?shot)\b/, "product"],
  [/\b(background|bg|backdrop)\b/, "background"],
  [/\b(body|copy|description|paragraph)\b/, "body"],
];

function roleFromName(name: string): SemanticRole | undefined {
  const n = name.toLowerCase().replace(/[_\-/.]+/g, " ");
  return ROLE_PATTERNS.find(([re]) => re.test(n))?.[1];
}

export function convertFigmaFrame(root: FigmaNode, opts: { assetKeyFor: (name: string) => string }): ConversionResult {
  const rootBox = root.absoluteBoundingBox;
  if (!rootBox || rootBox.width <= 0 || rootBox.height <= 0) {
    throw new Error(`"${root.name}" has no size. Select a frame in Figma, not a page or an empty selection.`);
  }
  const report: ConversionReport = {
    nodes: 0,
    layers: { text: 0, image: 0, shape: 0, group: 0 },
    rasterized: [],
    skipped: [],
    warnings: [],
    inferredRoles: {},
  };
  const imageFills = new Map<string, ImageFillRequest>();
  const rasters: RasterRequest[] = [];

  const fillAsset = (imageRef: string) => {
    let entry = imageFills.get(imageRef);
    if (!entry) imageFills.set(imageRef, (entry = { imageRef, assetKey: opts.assetKeyFor(`fill-${imageRef.replace(/[^a-zA-Z0-9]/g, "")}`) }));
    return entry.assetKey;
  };

  const base = (node: FigmaNode, box: Box, parent: Box) => {
    const role = roleFromName(node.name);
    if (role) report.inferredRoles[layerIdFor(node.id)] = role;
    return {
      id: layerIdFor(node.id),
      name: node.name,
      ...(role ? { role } : {}),
      x: round(box.x - parent.x),
      y: round(box.y - parent.y),
      width: round(box.width),
      height: round(box.height),
      rotation: 0,
      opacity: node.opacity ?? 1,
      visible: node.visible !== false,
      sourceRef: node.id,
    };
  };

  const rasterize = (node: FigmaNode, parent: Box, format: "png" | "svg", reason: string): Layer | null => {
    if (node.visible === false) {
      report.skipped.push({ nodeId: node.id, name: node.name, reason: `hidden, and would need rasterising (${reason})` });
      return null;
    }
    const box = node.absoluteRenderBounds ?? node.absoluteBoundingBox;
    if (!box) return null;
    const assetKey = `${opts.assetKeyFor(`node-${node.id.replace(/[^a-zA-Z0-9]/g, "_")}`)}.${format}`;
    rasters.push({ nodeId: node.id, format, assetKey });
    report.rasterized.push({ nodeId: node.id, name: node.name, reason });
    report.layers.image++;
    // The render already includes the node's own opacity.
    return { ...base(node, box, parent), opacity: 1, type: "image", assetKey, fit: "fill", cornerRadius: 0 };
  };

  const imageLayer = (node: FigmaNode, paint: FigmaPaint, box: Box, parent: Box, radius: number): Layer => {
    report.layers.image++;
    const fit = paint.scaleMode === "FIT" ? "contain" : paint.scaleMode === "FILL" || !paint.scaleMode ? "cover" : "fill";
    if (paint.scaleMode === "TILE" || paint.scaleMode === "STRETCH") {
      report.warnings.push(`"${node.name}": image scale mode ${paint.scaleMode} is approximated.`);
    }
    return { ...base(node, box, parent), type: "image", assetKey: `${fillAsset(paint.imageRef!)}`, fit, cornerRadius: radius };
  };

  const convert = (node: FigmaNode, parent: Box): Layer | null => {
    report.nodes++;
    const box = node.absoluteBoundingBox;
    if (!box) {
      report.skipped.push({ nodeId: node.id, name: node.name, reason: "no geometry" });
      return null;
    }
    const effects = (node.effects ?? []).filter((e) => e.visible !== false);
    if (node.blendMode && !["NORMAL", "PASS_THROUGH"].includes(node.blendMode)) {
      report.warnings.push(`"${node.name}": blend mode ${node.blendMode} is not reproduced.`);
    }
    if (Math.abs(node.rotation ?? 0) > 0.001) return rasterize(node, parent, "png", "rotated");
    if (node.isMask) return rasterize(node, parent, "png", "mask");
    if (VECTORS.has(node.type)) return rasterize(node, parent, "svg", `vector (${node.type.toLowerCase()})`);

    const fills = visiblePaints(node.fills);
    const radii = node.rectangleCornerRadii;
    const unevenRadii = radii !== undefined && new Set(radii).size > 1;
    const radius = node.cornerRadius ?? radii?.[0] ?? 0;

    if (node.type === "TEXT") {
      const s = node.style ?? {};
      if ((node.characterStyleOverrides ?? []).some((v) => v !== 0)) {
        report.warnings.push(`"${node.name}": mixed text styles were flattened to the base style.`);
      }
      if (effects.length) report.warnings.push(`"${node.name}": text effects are not reproduced.`);
      const solid = fills.find((p) => p.type === "SOLID" && p.color);
      if (fills.length !== 1 || !solid) report.warnings.push(`"${node.name}": only a single solid text colour is supported; used ${solid ? "the first solid fill" : "black"}.`);
      const fontSize = s.fontSize ?? 16;
      report.layers.text++;
      return {
        ...base(node, box, parent),
        type: "text",
        text: node.characters ?? "",
        style: {
          fontFamily: s.fontFamily ?? "Inter",
          fontWeight: s.fontWeight ?? 400,
          fontSize,
          ...(s.lineHeightPx ? { lineHeight: Math.round((s.lineHeightPx / fontSize) * 1000) / 1000 } : {}),
          letterSpacing: s.letterSpacing ?? 0,
          color: solid?.color ? rgba(solid.color, solid.opacity ?? 1) : "#000000",
          align: s.textAlignHorizontal === "CENTER" ? "center" : s.textAlignHorizontal === "RIGHT" ? "right" : "left",
          verticalAlign: s.textAlignVertical === "CENTER" ? "middle" : s.textAlignVertical === "BOTTOM" ? "bottom" : "top",
          italic: s.italic ?? false,
          transform: s.textCase === "UPPER" ? "uppercase" : s.textCase === "LOWER" ? "lowercase" : "none",
        },
      };
    }

    if (node.type === "RECTANGLE" || node.type === "ELLIPSE") {
      if (effects.length) return rasterize(node, parent, "png", "has effects (shadow or blur)");
      if (unevenRadii) return rasterize(node, parent, "png", "different corner radii");
      if (fills.length > 1) return rasterize(node, parent, "png", "multiple fills");
      const paint = fills[0];
      if (paint?.type === "IMAGE" && paint.imageRef) {
        if (node.type === "ELLIPSE") return rasterize(node, parent, "png", "image in an ellipse");
        return imageLayer(node, paint, box, parent, radius);
      }
      const fill = paint ? toFill(paint, box) : undefined;
      if (paint && !fill) return rasterize(node, parent, "png", `unsupported fill (${paint.type.toLowerCase()})`);
      const stroke = visiblePaints(node.strokes).find((p) => p.type === "SOLID" && p.color);
      report.layers.shape++;
      return {
        ...base(node, box, parent),
        type: "shape",
        shape: node.type === "ELLIPSE" ? "ellipse" : "rectangle",
        ...(fill ? { fill } : {}),
        ...(stroke?.color && node.strokeWeight ? { stroke: { color: rgba(stroke.color, stroke.opacity ?? 1), width: node.strokeWeight } } : {}),
        cornerRadius: radius,
      };
    }

    if (CONTAINERS.has(node.type)) {
      const kids = node.children ?? [];
      if (kids.some((k) => k.isMask && k.visible !== false)) return rasterize(node, parent, "png", "contains a mask");
      if (effects.length) report.warnings.push(`"${node.name}": the container's effects (shadow or blur) are not reproduced.`);
      if (unevenRadii) report.warnings.push(`"${node.name}": different corner radii were simplified to one.`);
      const children: Layer[] = [];
      let fill: Fill | undefined;
      for (const paint of fills) {
        if (paint.type === "IMAGE" && paint.imageRef) {
          children.push(imageLayer({ ...node, id: `${node.id}-fill`, name: `${node.name} image`, opacity: 1 }, paint, box, box, 0));
        } else {
          const f = toFill(paint, box);
          if (f && !fill) fill = f;
          else report.warnings.push(`"${node.name}": a ${paint.type.toLowerCase()} fill was dropped.`);
        }
      }
      for (const kid of kids) {
        const layer = convert(kid, box);
        if (layer) children.push(layer);
      }
      report.layers.group++;
      return { ...base(node, box, parent), type: "group", clip: node.clipsContent ?? false, ...(fill ? { fill } : {}), cornerRadius: radius, children };
    }

    return rasterize(node, parent, "png", `unsupported node type (${node.type.toLowerCase()})`);
  };

  // The selected frame becomes the document; its children become the layers.
  const top = convert({ ...root, rotation: 0, opacity: 1, isMask: false, effects: [] }, rootBox);
  let layers: Layer[];
  let background: Fill | undefined;
  if (top?.type === "group") {
    layers = top.children;
    background = top.fill;
    report.layers.group--;
    delete report.inferredRoles[top.id];
  } else {
    layers = top ? [top] : [];
  }

  inferMissingRoles(layers, report);

  return {
    document: { schemaVersion: 1, width: round(rootBox.width), height: round(rootBox.height), ...(background ? { background } : {}), layers },
    imageFills: [...imageFills.values()],
    rasters,
    report,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** If no layer was named as a headline, the largest visible text is treated as one. */
function inferMissingRoles(layers: Layer[], report: ConversionReport): void {
  const texts: Extract<Layer, { type: "text" }>[] = [];
  let hasHeadline = false;
  const visit = (list: Layer[]) => {
    for (const l of list) {
      if (l.role === "headline") hasHeadline = true;
      if (l.type === "text" && l.visible && !l.role) texts.push(l);
      if (l.type === "group") visit(l.children);
    }
  };
  visit(layers);
  if (hasHeadline || texts.length === 0) return;
  const largest = texts.reduce((a, b) => (b.style.fontSize > a.style.fontSize ? b : a));
  largest.role = "headline";
  report.inferredRoles[largest.id] = "headline";
}
