import type { DesignDocument, Fill, Layer } from "@adengine/core/design";

/**
 * The one renderer. It turns a design document into plain HTML with inline
 * styles and no scripts. The same output is used for workspace previews, the
 * editor, HTML5 export and headless capture, so what is approved is what is
 * exported.
 */

export interface RenderOptions {
  /** Maps an asset storage key to a URL the page can load. */
  assetUrl: (assetKey: string) => string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** Only plain CSS colour syntax is allowed through, so a document cannot inject CSS. */
function color(value: string): string {
  return /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\)|[a-zA-Z]{3,30})$/.test(value.trim()) ? value.trim() : "transparent";
}

export function fillToCss(fill: Fill | undefined): string | undefined {
  if (!fill) return undefined;
  if (fill.type === "solid") return color(fill.color);
  const stops = fill.stops.map((s) => `${color(s.color)} ${Math.round(s.offset * 10000) / 100}%`).join(", ");
  return `linear-gradient(${Number(fill.angle) || 0}deg, ${stops})`;
}

function fontStack(family: string): string {
  return `"${family.replace(/["\;{}<>]/g, "")}", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
}

function style(decls: Record<string, string | number | undefined | false>): string {
  return Object.entries(decls)
    .filter(([, v]) => v !== undefined && v !== false && v !== "")
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

function box(layer: Layer): Record<string, string | undefined | false> {
  return {
    position: "absolute",
    left: px(layer.x),
    top: px(layer.y),
    width: px(layer.width),
    height: px(layer.height),
    opacity: layer.opacity !== 1 && String(layer.opacity),
    transform: layer.rotation !== 0 && `rotate(${layer.rotation}deg)`,
    display: !layer.visible && "none",
    "box-sizing": "border-box",
  };
}

function attrs(layer: Layer): string {
  return `data-layer-id="${esc(layer.id)}" data-layer-type="${layer.type}"${layer.role ? ` data-role="${layer.role}"` : ""}`;
}

function renderLayer(layer: Layer, opts: RenderOptions): string {
  switch (layer.type) {
    case "text": {
      const s = layer.style;
      const justify = { top: "flex-start", middle: "center", bottom: "flex-end" }[s.verticalAlign];
      const css = style({
        ...box(layer),
        display: layer.visible ? "flex" : "none",
        "flex-direction": "column",
        "justify-content": justify,
        "font-family": fontStack(s.fontFamily),
        "font-weight": s.fontWeight,
        "font-size": px(s.fontSize),
        "font-style": s.italic && "italic",
        "line-height": s.lineHeight ?? "normal",
        "letter-spacing": s.letterSpacing !== 0 && px(s.letterSpacing),
        color: color(s.color),
        "text-align": s.align,
        "text-transform": s.transform !== "none" && s.transform,
        "white-space": "pre-wrap",
        "overflow-wrap": "break-word",
      });
      return `<div ${attrs(layer)} style="${css}"><span>${esc(layer.text)}</span></div>`;
    }
    case "image": {
      const focus = layer.focus ? `${layer.focus.x * 100}% ${layer.focus.y * 100}%` : undefined;
      const css = style({ ...box(layer), overflow: "hidden", "border-radius": layer.cornerRadius > 0 && px(layer.cornerRadius) });
      const img = style({ display: "block", width: "100%", height: "100%", "object-fit": layer.fit, "object-position": focus });
      return `<div ${attrs(layer)} style="${css}"><img src="${esc(opts.assetUrl(layer.assetKey))}" alt="" draggable="false" style="${img}"></div>`;
    }
    case "shape": {
      const css = style({
        ...box(layer),
        background: fillToCss(layer.fill),
        border: layer.stroke && layer.stroke.width > 0 && `${px(layer.stroke.width)} solid ${color(layer.stroke.color)}`,
        "border-radius": layer.shape === "ellipse" ? "50%" : layer.cornerRadius > 0 && px(layer.cornerRadius),
      });
      return `<div ${attrs(layer)} style="${css}"></div>`;
    }
    case "group": {
      const css = style({
        ...box(layer),
        overflow: layer.clip && "hidden",
        background: fillToCss(layer.fill),
        "border-radius": layer.cornerRadius > 0 && px(layer.cornerRadius),
      });
      return `<div ${attrs(layer)} style="${css}">${layer.children.map((c) => renderLayer(c, opts)).join("")}</div>`;
    }
  }
}

/** An HTML fragment of exactly `doc.width × doc.height` CSS pixels. */
export function renderDocument(doc: DesignDocument, opts: RenderOptions): string {
  const css = style({
    position: "relative",
    width: px(doc.width),
    height: px(doc.height),
    overflow: "hidden",
    background: fillToCss(doc.background) ?? "#ffffff",
  });
  return `<div data-ad-root style="${css}">${doc.layers.map((l) => renderLayer(l, opts)).join("")}</div>`;
}

/** Font families and the weights/styles each is used with. */
export function fontsUsed(doc: DesignDocument): { family: string; weights: number[]; italic: boolean }[] {
  const map = new Map<string, { weights: Set<number>; italic: boolean }>();
  const visit = (layers: Layer[]) => {
    for (const l of layers) {
      if (l.type === "text") {
        const entry = map.get(l.style.fontFamily) ?? { weights: new Set<number>(), italic: false };
        entry.weights.add(l.style.fontWeight);
        entry.italic ||= l.style.italic;
        map.set(l.style.fontFamily, entry);
      } else if (l.type === "group") visit(l.children);
    }
  };
  visit(doc.layers);
  return [...map].map(([family, v]) => ({ family, weights: [...v.weights].sort((a, b) => a - b), italic: v.italic }));
}

/**
 * Google Fonts stylesheet URLs for the document's fonts. A family that Google
 * Fonts does not host simply fails to load and the fallback stack is used;
 * supplying licensed brand fonts is a later capability.
 */
export function fontStylesheetUrls(doc: DesignDocument): string[] {
  return fontsUsed(doc).map(({ family, weights, italic }) => {
    const name = encodeURIComponent(family).replace(/%20/g, "+");
    const axis = italic
      ? `ital,wght@${[0, 1].flatMap((i) => weights.map((w) => `${i},${w}`)).join(";")}`
      : `wght@${weights.join(";")}`;
    return `https://fonts.googleapis.com/css2?family=${name}:${axis}&display=swap`;
  });
}

/** A complete standalone HTML page for the document (used for capture and export). */
export function renderPage(doc: DesignDocument, opts: RenderOptions): string {
  const links = fontStylesheetUrls(doc).map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">${links}<style>html,body{margin:0;padding:0}</style></head><body>${renderDocument(doc, opts)}</body></html>`;
}
