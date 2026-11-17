import type { DesignDocument, Layer, SemanticRole } from "@adengine/core/design";

/**
 * Read-only inspection of a design document. These are the functions the
 * agent tools, the API and the UI use to understand what is in a design.
 */

export interface LayerInfo {
  id: string;
  name: string;
  type: Layer["type"];
  role?: SemanticRole;
  /** Ids from the top-level ancestor down to the direct parent. */
  path: string[];
  depth: number;
  parentId: string | null;
  /** Position relative to the document's top-left corner. */
  absoluteX: number;
  absoluteY: number;
  width: number;
  height: number;
  visible: boolean;
  /** Text content, for text layers. */
  text?: string;
  /** Storage key, for image layers. */
  assetKey?: string;
  childCount?: number;
}

export function walkLayers(
  doc: DesignDocument,
  visit: (layer: Layer, ctx: { path: string[]; offsetX: number; offsetY: number; hidden: boolean }) => void,
): void {
  const recurse = (layers: Layer[], path: string[], ox: number, oy: number, hidden: boolean) => {
    for (const layer of layers) {
      visit(layer, { path, offsetX: ox, offsetY: oy, hidden });
      if (layer.type === "group") {
        recurse(layer.children, [...path, layer.id], ox + layer.x, oy + layer.y, hidden || !layer.visible);
      }
    }
  };
  recurse(doc.layers, [], 0, 0, false);
}

/** Every layer in paint order (back to front), flattened. */
export function listLayers(doc: DesignDocument): LayerInfo[] {
  const out: LayerInfo[] = [];
  walkLayers(doc, (layer, ctx) => {
    out.push({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      ...(layer.role ? { role: layer.role } : {}),
      path: ctx.path,
      depth: ctx.path.length,
      parentId: ctx.path.at(-1) ?? null,
      absoluteX: ctx.offsetX + layer.x,
      absoluteY: ctx.offsetY + layer.y,
      width: layer.width,
      height: layer.height,
      visible: layer.visible && !ctx.hidden,
      ...(layer.type === "text" ? { text: layer.text } : {}),
      ...(layer.type === "image" ? { assetKey: layer.assetKey } : {}),
      ...(layer.type === "group" ? { childCount: layer.children.length } : {}),
    });
  });
  return out;
}

export interface LayerFilter {
  type?: Layer["type"];
  role?: SemanticRole;
  /** Case-insensitive substring of the layer name. */
  name?: string;
}

export function findLayers(doc: DesignDocument, filter: LayerFilter): LayerInfo[] {
  const needle = filter.name?.toLowerCase();
  return listLayers(doc).filter(
    (l) =>
      (!filter.type || l.type === filter.type) &&
      (!filter.role || l.role === filter.role) &&
      (!needle || l.name.toLowerCase().includes(needle)),
  );
}

/** The full layer object (with style and children), or undefined. */
export function getLayer(doc: DesignDocument, id: string): Layer | undefined {
  let found: Layer | undefined;
  walkLayers(doc, (layer) => {
    if (layer.id === id) found ??= layer;
  });
  return found;
}

export interface DesignSummary {
  width: number;
  height: number;
  layerCount: number;
  byType: Record<Layer["type"], number>;
  roles: Partial<Record<SemanticRole, string[]>>;
  texts: { id: string; name: string; role?: SemanticRole; text: string }[];
  images: { id: string; name: string; role?: SemanticRole; assetKey: string }[];
  fonts: string[];
  problems: string[];
}

/** A compact overview: what an agent reads first to understand a design. */
export function summarizeDesign(doc: DesignDocument): DesignSummary {
  const layers = listLayers(doc);
  const byType: DesignSummary["byType"] = { text: 0, image: 0, shape: 0, group: 0 };
  const roles: DesignSummary["roles"] = {};
  const fonts = new Set<string>();
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const l of layers) {
    byType[l.type]++;
    if (l.role) (roles[l.role] ??= []).push(l.id);
    if (seen.has(l.id)) problems.push(`Duplicate layer id ${l.id}`);
    seen.add(l.id);
  }
  walkLayers(doc, (layer) => {
    if (layer.type === "text") fonts.add(layer.style.fontFamily);
  });
  return {
    width: doc.width,
    height: doc.height,
    layerCount: layers.length,
    byType,
    roles,
    texts: layers.filter((l) => l.type === "text").map((l) => ({ id: l.id, name: l.name, ...(l.role ? { role: l.role } : {}), text: l.text ?? "" })),
    images: layers.filter((l) => l.type === "image").map((l) => ({ id: l.id, name: l.name, ...(l.role ? { role: l.role } : {}), assetKey: l.assetKey ?? "" })),
    fonts: [...fonts].sort(),
    problems,
  };
}
