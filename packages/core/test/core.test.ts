import { describe, expect, it } from "vitest";
import { AppError, DesignDocument, isId, newId } from "../src/index.ts";

describe("ids", () => {
  it("creates prefixed unique ids", () => {
    const a = newId("project");
    expect(a).toMatch(/^prj_[0-9a-z]{16}$/);
    expect(isId("project", a)).toBe(true);
    expect(isId("campaign", a)).toBe(false);
    expect(new Set(Array.from({ length: 1000 }, () => newId("job"))).size).toBe(1000);
  });
});

describe("errors", () => {
  it("maps codes to HTTP statuses", () => {
    expect(AppError.notFound("Project", "prj_x").httpStatus).toBe(404);
    expect(new AppError("validation_error", "bad").toBody()).toEqual({ code: "validation_error", message: "bad" });
  });
});

describe("design document schema", () => {
  const doc = {
    schemaVersion: 1,
    width: 300,
    height: 250,
    background: { type: "solid", color: "#ffffff" },
    layers: [
      {
        id: "lyr_group",
        type: "group",
        name: "Content",
        x: 0, y: 0, width: 300, height: 250,
        children: [
          {
            id: "lyr_headline", type: "text", name: "Headline", role: "headline",
            x: 20, y: 20, width: 260, height: 60, text: "Run further",
            style: { fontFamily: "Inter", fontSize: 28, color: "#111111" },
          },
          { id: "lyr_cta_bg", type: "shape", name: "CTA bg", shape: "rectangle", x: 20, y: 190, width: 120, height: 40, fill: { type: "solid", color: "#0055ff" } },
        ],
      },
      { id: "lyr_product", type: "image", name: "Product", role: "product", x: 150, y: 80, width: 140, height: 140, assetKey: "fixtures/shoe.png" },
    ],
  };

  it("parses a nested document and applies defaults", () => {
    const parsed = DesignDocument.parse(doc);
    const group = parsed.layers[0]!;
    expect(group.type).toBe("group");
    expect(group.opacity).toBe(1);
    if (group.type !== "group") throw new Error("expected group");
    const headline = group.children[0]!;
    expect(headline.type === "text" && headline.style.fontWeight).toBe(400);
  });

  it("rejects unknown layer types and bad geometry", () => {
    expect(DesignDocument.safeParse({ ...doc, layers: [{ id: "x", type: "video", name: "v", x: 0, y: 0, width: 1, height: 1 }] }).success).toBe(false);
    expect(DesignDocument.safeParse({ ...doc, width: 0 }).success).toBe(false);
  });
});
