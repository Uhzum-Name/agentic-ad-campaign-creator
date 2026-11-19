import { describe, expect, it } from "vitest";
import { sniffImage } from "../src/images.ts";

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function jpeg(width: number, height: number): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

describe("sniffImage", () => {
  it("identifies formats and reads pixel sizes", () => {
    expect(sniffImage(PNG_1x1)).toEqual({ ext: "png", width: 1, height: 1 });
    expect(sniffImage(jpeg(1200, 628))).toEqual({ ext: "jpg", width: 1200, height: 628 });
    expect(sniffImage(Buffer.from("GIF89a\x40\x01\xf0\x00", "latin1"))).toEqual({ ext: "gif", width: 320, height: 240 });
    expect(sniffImage(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"></svg>'))).toEqual({ ext: "svg", width: 120, height: 40 });
    expect(sniffImage(Buffer.from('<svg width="64px" height="32" xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ ext: "svg", width: 64, height: 32 });
  });

  it("rejects anything else", () => {
    expect(sniffImage(Buffer.from("%PDF-1.7 not an image"))).toBeUndefined();
    expect(sniffImage(Buffer.from("<html><svg></svg></html>"))).toBeUndefined();
  });
});
