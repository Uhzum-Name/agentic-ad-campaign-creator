import { DesignDocument } from "@adengine/core";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "../../engine/src/fixtures.ts";
import { applyOverrides, changedDimensions, compileChanges, diffDocuments, dimensionAllowed, getLayer, textCapacity } from "../src/index.ts";

const doc = DesignDocument.parse(FIXTURES.find((f) => f.name === "trail-shoe-300x250")!.document);

describe("compileChanges", () => {
  it("resolves roles, groups and ids into overrides and classifies each change", () => {
    const r = compileChanges(doc, [
      { op: "set_text", target: { role: "headline" }, text: "Wet rock?\nKeep going." },
      { op: "set_text", target: { role: "cta" }, text: "Find your size" }, // the CTA group's label
      { op: "set_fill", target: { role: "cta" }, fill: { type: "solid", color: "#ffd23f" } }, // the CTA group's background shape
      { op: "set_text_style", target: { layerId: "headline" }, style: { color: "#ffd23f" } },
      { op: "replace_image", target: { role: "product" }, assetKey: "projects/p/images/boot.png", fit: "contain" },
      { op: "set_visibility", target: { role: "subheadline" }, visible: false },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.overrides).toEqual({
      headline: { text: "Wet rock?\nKeep going.", style: { color: "#ffd23f" } },
      "cta-label": { text: "Find your size" },
      "cta-background": { fill: { type: "solid", color: "#ffd23f" } },
      product: { assetKey: "projects/p/images/boot.png", crop: null, fit: "contain" },
      subheadline: { visible: false },
    });
    expect(r.dimensions.sort()).toEqual(["cta", "headline", "image", "layout", "visual_treatment"]);
    expect(r.assetKeys).toEqual(["projects/p/images/boot.png"]);
    const out = DesignDocument.parse(applyOverrides(doc, r.overrides));
    expect(getLayer(out, "cta-label")).toMatchObject({ text: "Find your size" });
    expect(getLayer(doc, "cta-label")).toMatchObject({ text: "Shop now" }); // source untouched
  });

  it("builds on a parent variation's overrides", () => {
    const parent = compileChanges(doc, [{ op: "set_text", target: { role: "headline" }, text: "A" }]).overrides;
    const child = compileChanges(doc, [{ op: "set_text_style", target: { role: "headline" }, style: { fontSize: 24 } }], { base: parent });
    expect(child.overrides.headline).toEqual({ text: "A", style: { fontSize: 24 } });
  });

  it("explains what it cannot do", () => {
    const r = compileChanges(doc, [
      { op: "set_text", target: { layerId: "nope" }, text: "x" },
      { op: "set_text", target: { role: "offer" }, text: "x" },
      { op: "set_text", target: { layerId: "product" }, text: "x" },
      { op: "replace_image", target: { role: "headline" }, assetKey: "k" },
      { op: "set_text_style", target: { role: "headline" }, style: { color: "red;background:url(x)" } },
      { op: "set_fill", target: { role: "headline" }, fill: { type: "solid", color: "#000" } },
      { op: "set_geometry", target: { role: "logo" } },
    ]);
    expect(r.errors).toEqual([
      'Change 1: no layer "nope" in the design.',
      'Change 2: no layer has the role "offer". Roles in this design: background, logo, headline, subheadline, product, cta. Use a layerId instead.',
      'Change 3: layer "product" is a image layer, not text.',
      'Change 4: role "headline" is a text layer, not image.',
      'Change 5: "red;background:url(x)" is not a colour. Use a hex value like #1a2b3c or rgb(…).',
      'Change 6: "Headline" is a text layer; fills apply to shapes and groups. For text colour use set_text_style.',
      "Change 7: give at least one of x, y, width, height.",
    ]);
  });

  it("warns about likely overflow and layers pushed off the canvas", () => {
    const headline = getLayer(doc, "headline");
    const cap = textCapacity(headline as never);
    expect(cap).toBeGreaterThan(10);
    const r = compileChanges(doc, [
      { op: "set_text", target: { role: "headline" }, text: "x".repeat(cap * 2) },
      { op: "set_geometry", target: { role: "logo" }, x: 400 },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toMatch(/It may overflow/);
    expect(r.warnings[1]).toBe('"Logo" is now entirely outside the 300×250 canvas.');
  });

  it("flags dimensions outside the plan", () => {
    const r = compileChanges(doc, [
      { op: "set_text", target: { role: "headline" }, text: "New" },
      { op: "replace_image", target: { role: "product" }, assetKey: "k" },
    ], { varyElements: ["headline", "cta"] });
    expect(r.outOfPlan).toEqual(["image"]);
    expect(dimensionAllowed("subheadline", ["messaging"])).toBe(true);
    expect(dimensionAllowed("background", ["image"])).toBe(true);
    expect(dimensionAllowed("layout", ["messaging"])).toBe(false);
  });
});

describe("diffDocuments", () => {
  it("lists what changed, by layer and dimension", () => {
    const r = compileChanges(doc, [
      { op: "set_text", target: { role: "headline" }, text: "New words" },
      { op: "set_fill", target: { role: "cta" }, fill: { type: "solid", color: "#000000" } },
      { op: "set_geometry", target: { role: "logo" }, y: 20 },
    ]);
    const diffs = diffDocuments(doc, applyOverrides(doc, r.overrides));
    expect(diffs.map((d) => `${d.layerName}: ${d.field} ${d.before} → ${d.after} (${d.dimension})`)).toEqual([
      "Logo: Position 16, 14 → 16, 20 (layout)",
      "Headline: Text Grip every\ntrail. → New words (headline)",
      "CTA background: Colour #ff7a3d → #000000 (cta)",
    ]);
    expect(changedDimensions(diffs)).toEqual(["layout", "headline", "cta"]);
    expect(diffDocuments(doc, doc)).toEqual([]);
  });
});

describe("editing operations", () => {
  it("changes opacity and stacking order, and validates direct overrides", async () => {
    const { overrideProblems, listLayers } = await import("../src/index.ts");
    const r = compileChanges(doc, [
      { op: "set_opacity", target: { role: "logo" }, opacity: 0.5 },
      { op: "reorder", target: { role: "headline" }, position: "back" },
      { op: "reorder", target: { layerId: "cta-label" }, position: "backward" },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.overrides.$order).toEqual({ $root: ["headline", "background", "logo", "subheadline", "product", "cta"], cta: ["cta-label", "cta-background"] });
    const out = applyOverrides(doc, r.overrides);
    expect(listLayers(out).map((l) => l.id)).toEqual(["headline", "background", "logo", "subheadline", "product", "cta", "cta-label", "cta-background"]);
    const diffs = diffDocuments(doc, out).map((d) => `${d.layerName}: ${d.field}`);
    expect(diffs).toEqual(["Logo: Opacity", "Canvas: Stacking order", "CTA: Stacking order"]);
    expect(r.dimensions.sort()).toEqual(["layout", "visual_treatment"]);
    expect(compileChanges(doc, [{ op: "reorder", target: { role: "cta" }, position: "front" }]).warnings[0]).toMatch(/already at the front/);

    expect(overrideProblems(doc, r.overrides)).toEqual([]);
    expect(overrideProblems(doc, { nope: { x: 1 }, headline: { assetKey: "x" }, logo: { opacity: 0.4 }, $order: { cta: ["headline"], logo: [] } })).toEqual([
      "No layer nope in the design",
      '"assetKey" cannot be changed on text layer headline',
      "Stacking order for cta must list only its own children, once each",
      "Stacking order given for logo, which is not a group",
    ]);
  });
});
