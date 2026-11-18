import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FontParseError, parseFont } from "../src/index.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name));

describe("parseFont", () => {
  it.each([
    ["ProbeSans-Regular.ttf", { format: "truetype", family: "Probe Sans", subfamily: "Regular", weight: 400, style: "normal" }],
    ["ProbeSans-BoldItalic.otf", { format: "opentype", family: "Probe Sans", subfamily: "Bold Italic", weight: 700, style: "italic" }],
    ["ProbeSans-Semibold.woff", { format: "woff", family: "Probe Sans", subfamily: "Semibold", weight: 600, style: "normal" }],
    ["ProbeSans-Light.woff2", { format: "woff2", family: "Probe Sans", subfamily: "Light", weight: 300, style: "normal" }],
    ["ProbeSans-BlackItalic.woff2", { format: "woff2", family: "Probe Sans", subfamily: "Black Italic", weight: 900, style: "italic" }],
  ])("reads %s", (file, expected) => {
    expect(parseFont(fixture(file))).toMatchObject(expected);
  });

  it("rejects files that are not fonts or are damaged", () => {
    expect(() => parseFont(Buffer.from("hello, this is not a font file"))).toThrow(FontParseError);
    expect(() => parseFont(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/not a font file/);
    const truncated = fixture("ProbeSans-Light.woff2").subarray(0, 60);
    expect(() => parseFont(truncated)).toThrow(FontParseError);
  });
});
