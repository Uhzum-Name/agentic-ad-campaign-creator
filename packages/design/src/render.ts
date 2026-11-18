import type { DesignDocument, Fill, Layer, TextLayer } from "@adengine/core/design";

/**
 * The one renderer. It turns a design document into plain HTML with inline
 * styles and no scripts. The same output is used for workspace previews, the
 * editor, HTML5 export and headless capture, so what is approved is what is
 * exported.
 */

export interface RenderOptions {
  /** Maps an asset storage key to a URL the page can load. */
  assetUrl: (assetKey: string) => string;
  /** Uploaded font files. Families listed here are not requested from Google Fonts. */
  fonts?: FontFace[];
}

/** One uploaded font file. */
export interface FontFace {
  family: string;
  weight: number;
  style: "normal" | "italic";
  format: "truetype" | "opentype" | "woff" | "woff2";
  assetKey: string;
}

const sameFamily = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** @font-face rules for uploaded fonts. */
export function fontFaceCss(faces: FontFace[], assetUrl: (key: string) => string): string {
  return faces
    .map((f) => {
      const family = f.family.replace(/['"\\;{}<>]/g, "");
      const url = assetUrl(f.assetKey).replace(/[\\'"()\s<>]/g, (c) => encodeURIComponent(c));
      return `@font-face{font-family:'${family}';src:url('${url}') format('${f.format}');font-weight:${Math.round(f.weight)};font-style:${f.style === "italic" ? "italic" : "normal"};font-display:block}`;
    })
    .join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
  // Single quotes only: this value sits inside a double-quoted style attribute.
  return `'${family.replace(/['"\\;{}<>]/g, "")}', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
}

function style(decls: Record<string, string | number | undefined | false>): string {
  // Escaped as a whole so no value can close the style attribute it is written into.
  return esc(
    Object.entries(decls)
      .filter(([, v]) => v !== undefined && v !== false && v !== "")
      .map(([k, v]) => `${k}:${v}`)
      .join(";"),
  );
}

const pct = (n: number) => `${Math.round(n * 1_000_000) / 10_000}%`;

/** Paragraphs as blocks (with paragraph spacing), styled runs as inline spans. */
function renderText(layer: TextLayer): string {
  const runs = (layer.runs ?? []).filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const spacing = layer.style.paragraphSpacing;
  const out: string[] = [];
  let offset = 0;
  layer.text.split("\n").forEach((para, i) => {
    const start = offset;
    const end = start + para.length;
    offset = end + 1;
    const parts: string[] = [];
    let cursor = start;
    for (const r of runs) {
      const a = Math.max(r.start, start);
      const b = Math.min(r.end, end);
      if (b <= a) continue;
      if (a > cursor) parts.push(esc(layer.text.slice(cursor, a)));
      parts.push(`<span style="${runStyle(r.style)}">${esc(layer.text.slice(a, b))}</span>`);
      cursor = b;
    }
    if (cursor < end) parts.push(esc(layer.text.slice(cursor, end)));
    const content = parts.join("").replace(/\u2028/g, "\n") || "<br>";
    const css = style({ display: "block", "margin-top": i > 0 && spacing > 0 && px(spacing) });
    out.push(`<span style="${css}">${content}</span>`);
  });
  return out.join("");
}

function runStyle(s: NonNullable<TextLayer["runs"]>[number]["style"]): string {
  return style({
    "font-family": s.fontFamily !== undefined && fontStack(s.fontFamily),
    "font-weight": s.fontWeight,
    "font-size": s.fontSize !== undefined && px(s.fontSize),
    "font-style": s.italic === undefined ? undefined : s.italic ? "italic" : "normal",
    "letter-spacing": s.letterSpacing !== undefined && px(s.letterSpacing),
    color: s.color !== undefined && color(s.color),
    "text-decoration": s.underline === undefined ? undefined : s.underline ? "underline" : "none",
  });
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
        "text-decoration": s.underline && "underline",
        "white-space": "pre-wrap",
        "overflow-wrap": "break-word",
      });
      return `<div ${attrs(layer)} style="${css}"><div>${renderText(layer)}</div></div>`;
    }
    case "image": {
      const focus = layer.focus ? `${layer.focus.x * 100}% ${layer.focus.y * 100}%` : undefined;
      const css = style({ ...box(layer), overflow: "hidden", "border-radius": layer.cornerRadius > 0 && px(layer.cornerRadius) });
      const c = layer.crop;
      const img = c
        ? style({
            position: "absolute",
            display: "block",
            "max-width": "none",
            width: pct(1 / c.width),
            height: pct(1 / c.height),
            left: pct(-c.x / c.width),
            top: pct(-c.y / c.height),
          })
        : style({ display: "block", width: "100%", height: "100%", "object-fit": layer.fit, "object-position": focus });
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
        const uses = [l.style, ...(l.runs ?? []).map((r) => ({ ...l.style, ...r.style }))];
        for (const u of uses) {
          const entry = map.get(u.fontFamily) ?? { weights: new Set<number>(), italic: false };
          entry.weights.add(u.fontWeight);
          entry.italic ||= u.italic;
          map.set(u.fontFamily, entry);
        }
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
export function fontStylesheetUrls(doc: DesignDocument, uploaded: FontFace[] = []): string[] {
  return fontsUsed(doc)
    .filter(({ family }) => !uploaded.some((f) => sameFamily(f.family, family)))
    .map(({ family, weights, italic }) => {
    const name = encodeURIComponent(family).replace(/%20/g, "+");
    const axis = italic
      ? `ital,wght@${[0, 1].flatMap((i) => weights.map((w) => `${i},${w}`)).join(";")}`
      : `wght@${weights.join(";")}`;
    return `https://fonts.googleapis.com/css2?family=${name}:${axis}&display=swap`;
  });
}

/** A complete standalone HTML page for the document (used for capture and export). */
export function renderPage(doc: DesignDocument, opts: RenderOptions): string {
  const links = fontStylesheetUrls(doc, opts.fonts).map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join("");
  const faces = fontFaceCss(opts.fonts ?? [], opts.assetUrl).replace(/</g, "\\3c ");
  return `<!doctype html><html><head><meta charset="utf-8">${links}<style>${faces}html,body{margin:0;padding:0}</style></head><body>${renderDocument(doc, opts)}</body></html>`;
}
