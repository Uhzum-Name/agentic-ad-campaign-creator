import { DesignDocument } from "@adengine/core";
import { describe, expect, it } from "vitest";
import { applyOverrides, findLayers, fontFaceCss, fontStylesheetUrls, getLayer, listLayers, renderDocument, renderPage, summarizeDesign } from "../src/index.ts";

const doc = DesignDocument.parse({
  schemaVersion: 1,
  width: 300,
  height: 250,
  background: { type: "linear-gradient", angle: 180, stops: [{ offset: 0, color: "#102030" }, { offset: 1, color: "#000000" }] },
  layers: [
    { id: "bg", type: "image", name: "Photo", role: "background", x: 0, y: 0, width: 300, height: 250, assetKey: "p/bg.jpg", focus: { x: 0.25, y: 0.5 } },
    {
      id: "content", type: "group", name: "Content", x: 20, y: 30, width: 260, height: 200, clip: true,
      children: [
        { id: "headline", type: "text", name: "Headline", role: "headline", x: 0, y: 0, width: 260, height: 60, text: "Run <further> & \"faster\"", style: { fontFamily: "Inter", fontSize: 28, fontWeight: 700, color: "#ffffff", lineHeight: 1.1 } },
        {
          id: "cta", type: "group", name: "CTA", role: "cta", x: 0, y: 150, width: 120, height: 40,
          children: [
            { id: "cta-bg", type: "shape", name: "Button", shape: "rectangle", x: 0, y: 0, width: 120, height: 40, cornerRadius: 20, fill: { type: "solid", color: "#ff5500" } },
            { id: "cta-label", type: "text", name: "Label", x: 0, y: 0, width: 120, height: 40, text: "Shop now", style: { fontFamily: "Inter", fontSize: 14, fontWeight: 600, color: "#fff", align: "center", verticalAlign: "middle" } },
          ],
        },
        { id: "hidden", type: "text", name: "Legal", role: "legal", visible: false, x: 0, y: 190, width: 260, height: 10, text: "T&Cs", style: { fontFamily: "Roboto Slab", fontSize: 8, color: "#999", italic: true } },
      ],
    },
  ],
});

describe("inspection", () => {
  it("flattens layers in paint order with absolute positions and paths", () => {
    const layers = listLayers(doc);
    expect(layers.map((l) => l.id)).toEqual(["bg", "content", "headline", "cta", "cta-bg", "cta-label", "hidden"]);
    const label = layers.find((l) => l.id === "cta-label")!;
    expect(label).toMatchObject({ path: ["content", "cta"], depth: 2, parentId: "cta", absoluteX: 20, absoluteY: 180, text: "Shop now" });
    expect(layers.find((l) => l.id === "content")).toMatchObject({ childCount: 3, parentId: null });
  });

  it("finds layers by type, role and name", () => {
    expect(findLayers(doc, { type: "text" }).map((l) => l.id)).toEqual(["headline", "cta-label", "hidden"]);
    expect(findLayers(doc, { role: "cta" }).map((l) => l.id)).toEqual(["cta"]);
    expect(findLayers(doc, { name: "LAB" }).map((l) => l.id)).toEqual(["cta-label"]);
    expect(getLayer(doc, "cta-bg")).toMatchObject({ type: "shape", cornerRadius: 20 });
    expect(getLayer(doc, "nope")).toBeUndefined();
  });

  it("summarizes a design", () => {
    const s = summarizeDesign(doc);
    expect(s).toMatchObject({ width: 300, height: 250, layerCount: 7, byType: { text: 3, image: 1, shape: 1, group: 2 }, fonts: ["Inter", "Roboto Slab"], problems: [] });
    expect(s.roles).toEqual({ background: ["bg"], headline: ["headline"], cta: ["cta"], legal: ["hidden"] });
    expect(s.texts.map((t) => t.text)).toContain("Shop now");
    expect(s.images).toEqual([{ id: "bg", name: "Photo", role: "background", assetKey: "p/bg.jpg" }]);
  });
});

describe("overrides", () => {
  it("patches layers without touching the source", () => {
    const before = JSON.stringify(doc);
    const out = applyOverrides(doc, { headline: { text: "Go", style: { color: "#ff0000" } }, "cta-label": { text: "Buy" }, bg: { assetKey: "p/other.jpg" } });
    expect(JSON.stringify(doc)).toBe(before);
    const h = getLayer(out, "headline");
    expect(h).toMatchObject({ text: "Go", style: { color: "#ff0000", fontSize: 28, fontWeight: 700 } });
    expect(getLayer(out, "cta-label")).toMatchObject({ text: "Buy" });
    expect(getLayer(out, "bg")).toMatchObject({ assetKey: "p/other.jpg" });
  });

  it("layers several override sets and protects identity fields", () => {
    const out = applyOverrides(doc, { headline: { text: "A", style: { color: "#111" } } }, null, { headline: { style: { fontSize: 20 } }, content: { id: "x", type: "text", children: [], x: 5 } });
    expect(getLayer(out, "headline")).toMatchObject({ text: "A", style: { color: "#111", fontSize: 20 } });
    expect(getLayer(out, "content")).toMatchObject({ id: "content", type: "group", x: 5 });
    expect(listLayers(out)).toHaveLength(7);
    expect(applyOverrides(doc, {}, undefined)).toBe(doc);
  });
});

describe("rich text and crops", () => {
  const rich = DesignDocument.parse({
    schemaVersion: 1, width: 300, height: 100,
    layers: [
      {
        id: "t", type: "text", name: "Copy", x: 0, y: 0, width: 300, height: 100,
        text: "First line\u2028wraps\nRead more >\n\nEnd",
        style: { fontFamily: "Inter", fontSize: 14, color: "#000", paragraphSpacing: 8 },
        runs: [{ start: 22, end: 28, style: { color: "#e31837", underline: true, fontFamily: "Lora", fontWeight: 600 } }],
      },
      { id: "i", type: "image", name: "Photo", x: 0, y: 0, width: 100, height: 100, assetKey: "a.jpg", crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 } },
    ],
  });
  const html = renderDocument(rich, { assetUrl: (k) => k });

  it("renders paragraphs with spacing, in-paragraph line breaks and styled ranges", () => {
    const paras = [...html.matchAll(/<span style="display:block[^"]*">/g)].map((m) => m[0]);
    expect(paras).toHaveLength(4);
    expect(paras[0]).not.toContain("margin-top");
    expect(paras[1]).toContain("margin-top:8px");
    expect(html).toContain("First line\nwraps");
    expect(html).toContain('Read <span style="font-family:&#39;Lora&#39;');
    expect(html).toContain("color:#e31837;text-decoration:underline\">more &gt;</span>");
    expect(html).toContain("<br>");
    expect(fontStylesheetUrls(rich)).toEqual([
      "https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap",
      "https://fonts.googleapis.com/css2?family=Lora:wght@600&display=swap",
    ]);
  });

  it("keeps only the properties a styled range sets", () => {
    const t = getLayer(rich, "t");
    expect(t?.type === "text" && t.runs?.[0]?.style).toEqual({ color: "#e31837", underline: true, fontFamily: "Lora", fontWeight: 600 });
  });

  it("shows only the cropped region of an image", () => {
    expect(html).toContain("position:absolute;display:block;max-width:none;width:200%;height:125%;left:-50%;top:-12.5%");
  });

  it("drops styled ranges when the text is replaced, keeps them otherwise", () => {
    expect(getLayer(applyOverrides(rich, { t: { text: "New copy" } }), "t")).not.toHaveProperty("runs");
    expect(getLayer(applyOverrides(rich, { t: { style: { color: "#111" } } }), "t")).toHaveProperty("runs");
    expect(summarizeDesign({ ...rich, layers: [{ ...rich.layers[0]!, text: "short" } as never] }).problems).toEqual(["Layer t has a styled range beyond its text"]);
  });
});

describe("rendering", () => {
  const html = renderDocument(doc, { assetUrl: (k) => `/assets/${k}` });

  it("produces one positioned element per layer", () => {
    expect(html.match(/data-layer-id=/g)).toHaveLength(7);
    expect(html).toContain('data-ad-root style="position:relative;width:300px;height:250px;overflow:hidden;background:linear-gradient(180deg, #102030 0%, #000000 100%)"');
    expect(html).toContain('data-layer-id="cta" data-layer-type="group" data-role="cta" style="position:absolute;left:0px;top:150px;width:120px;height:40px');
    expect(html).toContain('src="/assets/p/bg.jpg"');
    expect(html).toContain("object-position:25% 50%");
    expect(html).toContain("border-radius:20px");
    expect(html).toContain("overflow:hidden");
  });

  it("writes complete text styles into a well-formed style attribute", () => {
    const headline = /data-layer-id="headline"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(headline).toContain("font-family:&#39;Inter&#39;, system-ui");
    expect(headline).toContain("font-weight:700;font-size:28px");
    expect(headline).toContain("line-height:1.1");
    expect(headline).toContain("color:#ffffff");
    expect(headline).toContain("white-space:pre-wrap");
    // Every element carries exactly one style attribute that closes where it should.
    for (const m of html.matchAll(/style="([^"]*)"/g)) expect(m[1]).not.toMatch(/[<>]/);
    expect(html.match(/style="/g)!.length).toBe(html.match(/<(div|img)[ >]/g)!.length);
  });

  it("escapes text and hides invisible layers", () => {
    expect(html).toContain("Run &lt;further&gt; &amp; &quot;faster&quot;");
    expect(html).not.toContain("<further>");
    expect(html).toMatch(/data-layer-id="hidden"[^>]*display:none/);
  });

  it("neutralises unsafe style values", () => {
    const evil = DesignDocument.parse({
      schemaVersion: 1, width: 10, height: 10,
      layers: [{ id: "a", type: "text", name: "a", x: 0, y: 0, width: 10, height: 10, text: "x", style: { fontFamily: 'Inter";}</style><script>', fontSize: 10, color: "red;background:url(javascript:alert(1))" } }],
    });
    const out = renderDocument(evil, { assetUrl: (k) => k });
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("color:transparent");
  });

  it("declares uploaded fonts and does not request them from Google Fonts", () => {
    const faces = [{ family: "Roboto Slab", weight: 400, style: "italic" as const, format: "woff2" as const, assetKey: "projects/p/fonts/a b.woff2" }];
    expect(fontStylesheetUrls(doc, faces)).toEqual(["https://fonts.googleapis.com/css2?family=Inter:wght@600;700&display=swap"]);
    expect(fontFaceCss(faces, (k) => `/api/assets/${k}`)).toBe("@font-face{font-family:'Roboto Slab';src:url('/api/assets/projects/p/fonts/a%20b.woff2') format('woff2');font-weight:400;font-style:italic;font-display:block}");
    expect(fontFaceCss([{ ...faces[0]!, family: "x';}</style><script>" }], (k) => k)).not.toMatch(/<|'\}/);
    const page = renderPage(doc, { assetUrl: (k) => k, fonts: faces });
    expect(page).toContain("@font-face{font-family:'Roboto Slab'");
    expect(page).not.toContain("Roboto+Slab");
  });

  it("lists web font stylesheets and builds a standalone page", () => {
    expect(fontStylesheetUrls(doc)).toEqual([
      "https://fonts.googleapis.com/css2?family=Inter:wght@600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Roboto+Slab:ital,wght@0,400;1,400&display=swap",
    ]);
    const page = renderPage(doc, { assetUrl: (k) => k });
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain('rel="stylesheet"');
  });
});
