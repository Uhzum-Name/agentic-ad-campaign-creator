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

const PROTECTED = new Set(["id", "type", "children"]);

/** Combines override sets, later ones winning, with `style` merged one level deep. */
export function mergeOverrides(...overrideSets: (LayerOverrides | null | undefined)[]): LayerOverrides {
  const merged: LayerOverrides = {};
  for (const set of overrideSets) {
    for (const [id, patch] of Object.entries(set ?? {})) merged[id] = { ...merged[id], ...patch, ...mergeStyle(merged[id], patch) };
  }
  return merged;
}

export function applyOverrides(doc: DesignDocument, ...overrideSets: (LayerOverrides | null | undefined)[]): DesignDocument {
  const merged = mergeOverrides(...overrideSets);
  if (Object.keys(merged).length === 0) return doc;

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
      return next.type === "group" ? { ...next, children: patchLayers(next.children) } : next;
    });

  return { ...doc, layers: patchLayers(doc.layers) };
}

function mergeStyle(a: Record<string, unknown> | undefined, b: Record<string, unknown>): { style?: object } {
  const sa = a?.style;
  const sb = b.style;
  if (sa && sb && typeof sa === "object" && typeof sb === "object") return { style: { ...sa, ...sb } };
  return {};
}
