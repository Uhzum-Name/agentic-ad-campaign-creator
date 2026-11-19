import type { DesignDocument, Layer, SemanticRole, TextLayer } from "@adengine/core/design";
import type { ChangeDimension, LayerTarget, VariationChange } from "@adengine/core/variations";
import { type LayerInfo, getLayer, listLayers } from "./inspect.ts";
import { type LayerOverrides, applyOverrides, mergeOverrides } from "./overrides.ts";

/*
 * Turning an agent's described changes into overrides, and explaining the
 * difference between any two versions of a design. Pure and browser-safe.
 */

const ROLE_DIMENSION: Partial<Record<SemanticRole, ChangeDimension>> = {
  headline: "headline",
  subheadline: "subheadline",
  body: "body",
  cta: "cta",
  offer: "offer",
  product: "image",
  image: "image",
  background: "background",
  logo: "logo",
  legal: "legal",
  decoration: "visual_treatment",
};
const TEXT_DIMENSIONS = new Set<ChangeDimension>(["headline", "subheadline", "body", "offer", "messaging"]);

/** The layer's own role, or the nearest ancestor's (a label inside the CTA group counts as CTA). */
function effectiveRole(info: LayerInfo, byId: Map<string, LayerInfo>): SemanticRole | undefined {
  if (info.role) return info.role;
  for (let i = info.path.length - 1; i >= 0; i--) {
    const role = byId.get(info.path[i]!)?.role;
    if (role) return role;
  }
  return undefined;
}

type Field = "text" | "style" | "image" | "fill" | "geometry" | "visibility";

function dimensionFor(field: Field, role: SemanticRole | undefined): ChangeDimension {
  if (field === "geometry" || field === "visibility") return "layout";
  const byRole = role ? ROLE_DIMENSION[role] : undefined;
  if (field === "text") return byRole && byRole !== "image" && byRole !== "background" ? byRole : "messaging";
  if (field === "image") return byRole === "logo" ? "logo" : "image";
  // Style and fill: part of the CTA or offer if they belong to one, otherwise a visual treatment.
  return byRole === "cta" || byRole === "offer" ? byRole : "visual_treatment";
}

/** Whether a plan's varyElements permit a change of this dimension. "messaging" permits any copy change. */
export function dimensionAllowed(dimension: ChangeDimension, varyElements: readonly string[]): boolean {
  if (varyElements.includes(dimension)) return true;
  if (dimension === "background" && varyElements.includes("image")) return true;
  return varyElements.includes("messaging") && TEXT_DIMENSIONS.has(dimension);
}

const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\)|[a-zA-Z]{3,30})$/;

/**
 * Rough number of characters a text box holds at its font size, assuming an
 * average glyph width of about half the font size. An estimate for guidance;
 * the browser preview measures actual overflow.
 */
export function textCapacity(layer: TextLayer): number {
  const s = layer.style;
  const perLine = Math.max(1, Math.floor(layer.width / (s.fontSize * 0.52 + Math.max(0, s.letterSpacing))));
  const lines = Math.max(1, Math.floor(layer.height / (s.fontSize * (s.lineHeight ?? 1.2))));
  return perLine * lines;
}

export interface CompiledChanges {
  overrides: LayerOverrides;
  /** Every dimension the changes touch. */
  dimensions: ChangeDimension[];
  /** Dimensions touched that the plan does not list. */
  outOfPlan: ChangeDimension[];
  /** Image keys referenced, for the caller to check they belong to the project. */
  assetKeys: string[];
  errors: string[];
  warnings: string[];
}

/**
 * Validates changes against a design and compiles them into overrides on top
 * of `base` (the parent variation's overrides, if any).
 */
export function compileChanges(doc: DesignDocument, changes: VariationChange[], opts: { base?: LayerOverrides; varyElements?: readonly string[] | null } = {}): CompiledChanges {
  const layers = listLayers(doc);
  const byId = new Map(layers.map((l) => [l.id, l]));
  const errors: string[] = [];
  const warnings: string[] = [];
  const dims = new Set<ChangeDimension>();
  const assetKeys = new Set<string>();
  let overrides: LayerOverrides = { ...(opts.base ?? {}) };

  const describe = (t: LayerTarget) => ("layerId" in t ? `layer "${t.layerId}"` : `role "${t.role}"`);

  const resolve = (target: LayerTarget, want: Layer["type"] | "any", n: number): LayerInfo[] => {
    let found: LayerInfo[];
    if ("layerId" in target) {
      const info = byId.get(target.layerId);
      if (!info) {
        errors.push(`Change ${n}: no ${describe(target)} in the design.`);
        return [];
      }
      found = [info];
    } else {
      found = layers.filter((l) => l.role === target.role);
      if (found.length === 0) {
        const roles = [...new Set(layers.map((l) => l.role).filter(Boolean))].join(", ") || "none";
        errors.push(`Change ${n}: no layer has the role "${target.role}". Roles in this design: ${roles}. Use a layerId instead.`);
        return [];
      }
      if (found.length > 1) {
        errors.push(`Change ${n}: several layers have the role "${target.role}" (${found.map((l) => l.id).join(", ")}). Use a layerId.`);
        return [];
      }
    }
    const layer = found[0]!;
    if (want === "any" || layer.type === want) return [layer];
    if (layer.type !== "group") {
      errors.push(`Change ${n}: ${describe(target)} is a ${layer.type} layer, not ${want}.`);
      return [];
    }
    // A group stands for the parts inside it: its text, its image, its background shape.
    const inside = layers.filter((l) => l.path.includes(layer.id) && l.type === want);
    if (want === "text" && inside.length >= 1) return inside;
    if (inside.length === 1) return inside;
    errors.push(
      `Change ${n}: ${describe(target)} is a group with ${inside.length} ${want} layers inside${inside.length ? ` (${inside.map((l) => l.id).join(", ")})` : ""}. Target one by layerId.`,
    );
    return [];
  };

  const patch = (id: string, values: Record<string, unknown>) => {
    overrides = mergeOverrides(overrides, { [id]: values });
  };

  changes.forEach((change, i) => {
    const n = i + 1;
    switch (change.op) {
      case "set_text": {
        const targets = resolve(change.target, "text", n);
        if (targets.length > 1) {
          errors.push(`Change ${n}: ${describe(change.target)} contains several text layers (${targets.map((t) => t.id).join(", ")}). Target one by layerId.`);
          return;
        }
        const t = targets[0];
        if (!t) return;
        patch(t.id, { text: change.text });
        dims.add(dimensionFor("text", effectiveRole(t, byId)));
        if (!change.text.trim()) warnings.push(`Change ${n}: the text of "${t.name}" is empty; consider set_visibility instead.`);
        const layer = getLayer(doc, t.id) as TextLayer;
        const cap = textCapacity(layer);
        if (change.text.length > cap * 1.15) {
          warnings.push(`Change ${n}: "${change.text.slice(0, 40)}${change.text.length > 40 ? "…" : ""}" is ${change.text.length} characters; "${t.name}" holds about ${cap}. It may overflow.`);
        }
        return;
      }
      case "set_text_style": {
        if (change.style.color && !COLOR.test(change.style.color.trim())) {
          errors.push(`Change ${n}: "${change.style.color}" is not a colour. Use a hex value like #1a2b3c or rgb(…).`);
          return;
        }
        for (const t of resolve(change.target, "text", n)) {
          patch(t.id, { style: change.style });
          dims.add(dimensionFor("style", effectiveRole(t, byId)));
        }
        return;
      }
      case "replace_image": {
        const t = resolve(change.target, "image", n)[0];
        if (!t) return;
        // A new image starts uncropped unless told otherwise; the old crop belonged to the old picture.
        patch(t.id, { assetKey: change.assetKey, crop: null, ...(change.fit ? { fit: change.fit } : {}), ...(change.focus ? { focus: change.focus } : {}) });
        assetKeys.add(change.assetKey);
        dims.add(dimensionFor("image", effectiveRole(t, byId)));
        return;
      }
      case "set_fill": {
        const colors = change.fill.type === "solid" ? [change.fill.color] : change.fill.stops.map((s) => s.color);
        const bad = colors.find((c) => !COLOR.test(c.trim()));
        if (bad) {
          errors.push(`Change ${n}: "${bad}" is not a colour.`);
          return;
        }
        const target = "layerId" in change.target ? byId.get(change.target.layerId) : layers.find((l) => l.role === (change.target as { role: SemanticRole }).role);
        // A group's own fill if it has one or contains no shape; otherwise its single shape (e.g. a button background).
        let t: LayerInfo | undefined;
        if (target?.type === "group") {
          const group = getLayer(doc, target.id);
          const shapes = layers.filter((l) => l.path.includes(target.id) && l.type === "shape");
          t = group?.type === "group" && (group.fill || shapes.length === 0) ? target : resolve(change.target, "shape", n)[0];
        } else {
          t = resolve(change.target, "any", n)[0];
          if (t && t.type !== "shape" && t.type !== "group") {
            errors.push(`Change ${n}: "${t.name}" is a ${t.type} layer; fills apply to shapes and groups. For text colour use set_text_style.`);
            return;
          }
        }
        if (!t) return;
        patch(t.id, { fill: change.fill });
        dims.add(dimensionFor("fill", effectiveRole(t, byId)));
        return;
      }
      case "set_geometry": {
        const t = resolve(change.target, "any", n)[0];
        if (!t) return;
        const values = Object.fromEntries(Object.entries({ x: change.x, y: change.y, width: change.width, height: change.height }).filter(([, v]) => v !== undefined));
        if (Object.keys(values).length === 0) {
          errors.push(`Change ${n}: give at least one of x, y, width, height.`);
          return;
        }
        patch(t.id, values);
        dims.add("layout");
        return;
      }
      case "set_visibility": {
        const t = resolve(change.target, "any", n)[0];
        if (!t) return;
        patch(t.id, { visible: change.visible });
        dims.add("layout");
        return;
      }
    }
  });

  // Geometry checks on the result: nothing pushed entirely off the canvas.
  if (errors.length === 0) {
    const result = applyOverrides(doc, overrides);
    for (const l of listLayers(result)) {
      if (!l.visible || !overrides[l.id]) continue;
      const outside = l.absoluteX >= doc.width || l.absoluteY >= doc.height || l.absoluteX + l.width <= 0 || l.absoluteY + l.height <= 0;
      if (outside) warnings.push(`"${l.name}" is now entirely outside the ${doc.width}×${doc.height} canvas.`);
    }
  }

  const dimensions = [...dims];
  const outOfPlan = opts.varyElements?.length ? dimensions.filter((d) => !dimensionAllowed(d, opts.varyElements!)) : [];
  return { overrides, dimensions, outOfPlan, assetKeys: [...assetKeys], errors, warnings };
}

// ---------------------------------------------------------------- differences

export interface LayerDifference {
  layerId: string;
  layerName: string;
  dimension: ChangeDimension;
  /** What changed, in words: "Text", "Image", "Colour", "Position", ... */
  field: string;
  before: string;
  after: string;
}

const fmtFill = (f: unknown) => {
  const fill = f as { type: string; color?: string; stops?: { color: string }[] } | undefined;
  if (!fill) return "none";
  return fill.type === "solid" ? (fill.color ?? "") : `gradient ${fill.stops?.map((s) => s.color).join(" → ")}`;
};
const fileName = (k: string | undefined) => (k ? (k.split("/").pop() ?? k) : "none");

/**
 * Layer by layer, what differs between two versions of the same design.
 * `assetName` turns an image's storage key into a readable name (e.g. the
 * library name it was uploaded with); by default the file name is shown.
 */
export function diffDocuments(from: DesignDocument, to: DesignDocument, opts: { assetName?: (assetKey: string) => string | undefined } = {}): LayerDifference[] {
  const imageName = (k: string | undefined) => (k ? (opts.assetName?.(k) ?? fileName(k)) : "none");
  const a = new Map(listLayers(from).map((l) => [l.id, l]));
  const infos = listLayers(to);
  const byId = new Map(infos.map((l) => [l.id, l]));
  const out: LayerDifference[] = [];
  for (const info of infos) {
    const before = getLayer(from, info.id);
    const after = getLayer(to, info.id);
    if (!before || !after || !a.has(info.id)) continue;
    const role = effectiveRole(info, byId);
    const add = (field: Field, label: string, b: string, c: string) => {
      if (b !== c) out.push({ layerId: info.id, layerName: info.name, dimension: dimensionFor(field, role), field: label, before: b, after: c });
    };
    if (before.type === "text" && after.type === "text") {
      add("text", "Text", before.text, after.text);
      const keys = new Set([...Object.keys(before.style), ...Object.keys(after.style)]) as Set<keyof TextLayer["style"]>;
      for (const k of keys) {
        const label = { color: "Text colour", fontFamily: "Font", fontWeight: "Font weight", fontSize: "Font size" }[k as string] ?? `Text ${String(k)}`;
        add("style", label, String(before.style[k] ?? ""), String(after.style[k] ?? ""));
      }
    }
    if (before.type === "image" && after.type === "image") {
      add("image", "Image", imageName(before.assetKey), imageName(after.assetKey));
      add("image", "Image fit", before.fit, after.fit);
    }
    if ((before.type === "shape" || before.type === "group") && (after.type === "shape" || after.type === "group")) {
      add("fill", "Colour", fmtFill(before.fill), fmtFill(after.fill));
    }
    add("geometry", "Position", `${before.x}, ${before.y}`, `${after.x}, ${after.y}`);
    add("geometry", "Size", `${before.width} × ${before.height}`, `${after.width} × ${after.height}`);
    add("visibility", "Visibility", before.visible ? "shown" : "hidden", after.visible ? "shown" : "hidden");
  }
  return out;
}

/** The distinct dimensions in a list of differences, in a stable order. */
export function changedDimensions(diffs: LayerDifference[]): ChangeDimension[] {
  return [...new Set(diffs.map((d) => d.dimension))];
}
