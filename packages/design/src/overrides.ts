import type { DesignDocument, Layer } from "@adengine/core/design";

/**
 * Overrides are patches keyed by layer id, applied on top of a source design
 * without modifying it. A patch shallow-merges into the layer; `style` (text)
 * merges one level deeper so a single style property can change on its own.
 * Replacing a text layer's `text` drops its styled `runs` unless new runs are given.
 * A property set to `null` is removed from the layer.
 * Identity fields (`id`, `type`, `children`) cannot be overridden.
 */
export type LayerOverrides = Record<string, Record<string, unknown>>;

/**
 * Stacking order is stored under this reserved key: parent id (or ROOT for the
 * top level) → child ids, back to front. Children not listed keep their
 * relative order after the listed ones.
 */
export const ORDER_KEY = "$order";
export const ROOT = "$root";

const PROTECTED = new Set(["id", "type", "children"]);

/** Combines override sets, later ones winning, with `style` merged one level deep. */
export function mergeOverrides(...overrideSets: (LayerOverrides | null | undefined)[]): LayerOverrides {
  const merged: LayerOverrides = {};
  for (const set of overrideSets) {
    for (const [id, patch] of Object.entries(set ?? {})) {
      // Orders replace per parent rather than merging lists.
      merged[id] = id === ORDER_KEY ? { ...merged[id], ...patch } : { ...merged[id], ...patch, ...mergeStyle(merged[id], patch) };
    }
  }
  return merged;
}

function reorder(layers: Layer[], order: unknown): Layer[] {
  if (!Array.isArray(order)) return layers;
  const byId = new Map(layers.map((l) => [l.id, l]));
  const listed = order.filter((id): id is string => typeof id === "string" && byId.has(id));
  const rest = layers.filter((l) => !listed.includes(l.id));
  return [...listed.map((id) => byId.get(id)!), ...rest];
}

export function applyOverrides(doc: DesignDocument, ...overrideSets: (LayerOverrides | null | undefined)[]): DesignDocument {
  const merged = mergeOverrides(...overrideSets);
  if (Object.keys(merged).length === 0) return doc;

  const orders = (merged[ORDER_KEY] ?? {}) as Record<string, unknown>;
  const patchLayers = (layers: Layer[]): Layer[] =>
    layers.map((layer) => {
      const patch = merged[layer.id];
      let next: Layer = layer;
      if (patch) {
        const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => !PROTECTED.has(k)));
        next = { ...layer, ...clean } as Layer;
        // A null value removes the property (e.g. clearing an image crop).
        for (const [k, v] of Object.entries(clean)) if (v === null) delete (next as Record<string, unknown>)[k];
        if (layer.type === "text") {
          const text = next as typeof layer;
          if (clean.style && typeof clean.style === "object") text.style = { ...layer.style, ...(clean.style as object) };
          // New wording invalidates styled ranges, which index into the old text.
          if ("text" in clean && !("runs" in clean) && clean.text !== layer.text) delete text.runs;
        }
      }
      return next.type === "group" ? { ...next, children: reorder(patchLayers(next.children), orders[layer.id]) } : next;
    });

  return { ...doc, layers: reorder(patchLayers(doc.layers), orders[ROOT]) };
}

function mergeStyle(a: Record<string, unknown> | undefined, b: Record<string, unknown>): { style?: object } {
  const sa = a?.style;
  const sb = b.style;
  if (sa && sb && typeof sa === "object" && typeof sb === "object") return { style: { ...sa, ...sb } };
  return {};
}

const COMMON_FIELDS = ["x", "y", "width", "height", "opacity", "visible", "rotation"];
const FIELDS: Record<Layer["type"], string[]> = {
  text: [...COMMON_FIELDS, "text", "style", "runs"],
  image: [...COMMON_FIELDS, "assetKey", "fit", "focus", "crop", "cornerRadius"],
  shape: [...COMMON_FIELDS, "fill", "stroke", "cornerRadius"],
  group: [...COMMON_FIELDS, "fill", "clip", "cornerRadius"],
};

/**
 * Checks an overrides object written directly (by the editor) before it is
 * stored: only existing layers, only fields that layer type has, and stacking
 * orders that name the parent's real children. Value types are then checked by
 * parsing the result as a design document.
 */
export function overrideProblems(doc: DesignDocument, overrides: LayerOverrides): string[] {
  const problems: string[] = [];
  const layers = new Map<string, Layer>();
  const children = new Map<string, string[]>([[ROOT, doc.layers.map((l) => l.id)]]);
  const walk = (list: Layer[]) => {
    for (const l of list) {
      layers.set(l.id, l);
      if (l.type === "group") {
        children.set(l.id, l.children.map((c) => c.id));
        walk(l.children);
      }
    }
  };
  walk(doc.layers);
  for (const [id, patch] of Object.entries(overrides)) {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      problems.push(`Overrides for ${id} must be an object`);
      continue;
    }
    if (id === ORDER_KEY) {
      for (const [parent, order] of Object.entries(patch)) {
        const kids = children.get(parent);
        if (!kids) problems.push(`Stacking order given for ${parent}, which is not a group`);
        else if (!Array.isArray(order) || order.some((c) => !kids.includes(c as string)) || new Set(order).size !== order.length) {
          problems.push(`Stacking order for ${parent} must list only its own children, once each`);
        }
      }
      continue;
    }
    const layer = layers.get(id);
    if (!layer) {
      problems.push(`No layer ${id} in the design`);
      continue;
    }
    const allowed = FIELDS[layer.type];
    for (const key of Object.keys(patch)) if (!allowed.includes(key)) problems.push(`"${key}" cannot be changed on ${layer.type} layer ${id}`);
  }
  return problems;
}
