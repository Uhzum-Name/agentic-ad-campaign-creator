import { describe, expect, it } from "vitest";
import { FIGMA_FRAME } from "../../../apps/api/test/figma-fixture.ts";
import { convertFigmaFrame, parseFigmaUrl } from "../src/index.ts";

describe("parseFigmaUrl", () => {
  it("reads the file key and node id from design links", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/My-File?node-id=12-345&t=x")).toEqual({ fileKey: "AbC123", nodeId: "12:345" });
    expect(parseFigmaUrl("https://figma.com/file/AbC123/Old-style")).toEqual({ fileKey: "AbC123" });
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/branch/Br456/Name?node-id=1-2")).toEqual({ fileKey: "Br456", nodeId: "1:2" });
  });
  it("rejects anything that is not a Figma design link", () => {
    for (const bad of ["not a url", "https://example.com/design/x/y", "https://www.figma.com/board/x/y", "https://www.figma.com/"]) {
      expect(() => parseFigmaUrl(bad)).toThrowError(/link/);
    }
  });
});

describe("convertFigmaFrame", () => {
  const result = convertFigmaFrame(FIGMA_FRAME, { assetKeyFor: (n) => `designs/d1/${n}` });
  const byName = (name: string) => result.document.layers.find((l) => l.name === name)!;

  it("uses the frame as the document and positions children relative to it", () => {
    expect(result.document).toMatchObject({ width: 300, height: 250, background: { type: "solid", color: "#0d1a33" } });
    expect(result.document.layers.map((l) => l.name)).toEqual(["Photo", "Big words", "Body copy", "CTA Button", "Logo", "Card", "Sticker", "Hidden note", "Glow", "Broken star"]);
    expect(byName("Big words")).toMatchObject({ id: "fg_1_4", x: 20, y: 24, width: 200, height: 64, sourceRef: "1:4" });
  });

  it("keeps text live and editable with its style", () => {
    expect(byName("Big words")).toMatchObject({
      type: "text", text: "Go further",
      style: { fontFamily: "Inter", fontWeight: 800, fontSize: 30, lineHeight: 1.1, letterSpacing: -0.5, color: "#ffffff", align: "left", verticalAlign: "top" },
    });
    expect(byName("Body copy")).toMatchObject({ role: "body", style: { align: "center", transform: "uppercase", italic: true, lineHeight: 1.4, color: "rgba(204,217,230,0.9)" } });
    expect(byName("Hidden note")).toMatchObject({ type: "text", visible: false });
  });

  it("converts shapes, nested groups, strokes and gradients", () => {
    const cta = byName("CTA Button");
    expect(cta).toMatchObject({ type: "group", role: "cta", x: 20, y: 190, clip: false });
    if (cta.type !== "group") throw new Error("expected group");
    expect(cta.children[0]).toMatchObject({ type: "shape", x: 0, y: 0, cornerRadius: 20, fill: { type: "solid", color: "#ff6600" }, stroke: { color: "#000000", width: 2 } });
    expect(cta.children[1]).toMatchObject({ type: "text", text: "Shop now", style: { align: "center", verticalAlign: "middle" } });
    expect(byName("Glow")).toMatchObject({ type: "shape", shape: "ellipse", opacity: 0.5, fill: { type: "linear-gradient", angle: 90, stops: [{ offset: 0, color: "#ffff00" }, { offset: 1, color: "rgba(255,0,0,0)" }] } });
  });

  it("requests image fills and rasterises what cannot be reproduced", () => {
    expect(byName("Photo")).toMatchObject({ type: "image", fit: "cover", assetKey: "designs/d1/fill-imgref1" });
    expect(result.imageFills).toEqual([{ imageRef: "img:ref/1", assetKey: "designs/d1/fill-imgref1" }]);
    expect(result.rasters).toEqual([
      { nodeId: "1:9", format: "svg", assetKey: "designs/d1/node-1_9.svg" },
      { nodeId: "1:10", format: "png", assetKey: "designs/d1/node-1_10.png" },
      { nodeId: "1:11", format: "png", assetKey: "designs/d1/node-1_11.png" },
      { nodeId: "1:14", format: "svg", assetKey: "designs/d1/node-1_14.svg" },
    ]);
    // A shape with a shadow uses its render bounds so the shadow is not cut off.
    expect(byName("Card")).toMatchObject({ type: "image", x: 190, y: 140, width: 100, height: 104, fit: "fill" });
    expect(result.report.rasterized.map((r) => r.reason)).toEqual(["vector (vector)", "has effects (shadow or blur)", "rotated", "vector (star)"]);
  });

  it("reports roles, counts and warnings", () => {
    expect(result.report.inferredRoles).toEqual({ fg_1_5: "body", fg_1_6: "cta", fg_1_9: "logo", fg_1_4: "headline" });
    expect(result.report.layers).toEqual({ text: 4, image: 5, shape: 2, group: 1 });
    expect(result.report.warnings).toEqual(['"Body copy": mixed text styles were flattened to the base style.']);
  });

  it("rejects a node without a size", () => {
    expect(() => convertFigmaFrame({ id: "0:1", name: "Page 1", type: "CANVAS" }, { assetKeyFor: (n) => n })).toThrowError(/Select a frame/);
  });
});
