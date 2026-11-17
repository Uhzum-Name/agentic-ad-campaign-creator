import type { FetchLike, FigmaNode } from "@adengine/figma";

/*
 * A stand-in for the Figma REST API, used by tests. The response shapes follow
 * Figma's published REST documentation; they are hand-written here, not
 * recorded from a real file, so these tests prove our handling of that shape
 * rather than Figma's behaviour.
 */

const solid = (r: number, g: number, b: number, a = 1) => ({ type: "SOLID", color: { r, g, b, a } });
const box = (x: number, y: number, width: number, height: number) => ({ x: 100 + x, y: 200 + y, width, height });

export const FIGMA_FRAME: FigmaNode = {
  id: "1:2",
  name: "Banner 300x250",
  type: "FRAME",
  absoluteBoundingBox: box(0, 0, 300, 250),
  clipsContent: true,
  fills: [solid(0.05, 0.1, 0.2)],
  children: [
    { id: "1:3", name: "Photo", type: "RECTANGLE", absoluteBoundingBox: box(0, 0, 300, 250), fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "img:ref/1" }] },
    {
      id: "1:4", name: "Big words", type: "TEXT", absoluteBoundingBox: box(20, 24, 200, 64), characters: "Go further", fills: [solid(1, 1, 1)],
      style: { fontFamily: "Inter", fontWeight: 800, fontSize: 30, lineHeightPx: 33, letterSpacing: -0.5, textAlignHorizontal: "LEFT", textAlignVertical: "TOP" },
    },
    {
      id: "1:5", name: "Body copy", type: "TEXT", absoluteBoundingBox: box(20, 96, 180, 30), characters: "Built for the long way round.", fills: [solid(0.8, 0.85, 0.9, 0.9)],
      characterStyleOverrides: [0, 0, 1, 1], style: { fontFamily: "Inter", fontWeight: 400, fontSize: 12, lineHeightPx: 16.8, textAlignHorizontal: "CENTER", textCase: "UPPER", italic: true },
    },
    {
      id: "1:6", name: "CTA Button", type: "FRAME", absoluteBoundingBox: box(20, 190, 120, 40), clipsContent: false, fills: [],
      children: [
        { id: "1:7", name: "Pill", type: "RECTANGLE", absoluteBoundingBox: box(20, 190, 120, 40), cornerRadius: 20, fills: [solid(1, 0.4, 0)], strokes: [solid(0, 0, 0)], strokeWeight: 2 },
        { id: "1:8", name: "Label", type: "TEXT", absoluteBoundingBox: box(20, 190, 120, 40), characters: "Shop now", fills: [solid(0, 0, 0)], style: { fontFamily: "Inter", fontWeight: 700, fontSize: 14, textAlignHorizontal: "CENTER", textAlignVertical: "CENTER" } },
      ],
    },
    { id: "1:9", name: "Logo", type: "VECTOR", absoluteBoundingBox: box(220, 16, 60, 20), fills: [solid(1, 1, 1)] },
    { id: "1:10", name: "Card", type: "RECTANGLE", absoluteBoundingBox: box(200, 150, 80, 80), absoluteRenderBounds: box(190, 140, 100, 104), fills: [solid(1, 1, 1)], effects: [{ type: "DROP_SHADOW", visible: true }] },
    { id: "1:11", name: "Sticker", type: "RECTANGLE", absoluteBoundingBox: box(230, 60, 50, 50), rotation: 0.3, fills: [solid(1, 0, 0)] },
    { id: "1:12", name: "Hidden note", type: "TEXT", visible: false, absoluteBoundingBox: box(0, 0, 50, 10), characters: "draft", fills: [solid(0, 0, 0)], style: { fontFamily: "Inter", fontSize: 8 } },
    {
      id: "1:13", name: "Glow", type: "ELLIPSE", absoluteBoundingBox: box(150, 100, 40, 40), opacity: 0.5,
      fills: [{ type: "GRADIENT_LINEAR", gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }], gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 0, b: 0, a: 0 } }] }],
    },
    { id: "1:14", name: "Broken star", type: "STAR", absoluteBoundingBox: box(5, 5, 10, 10), fills: [solid(1, 1, 0)] },
  ],
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const figmaCalls: string[] = [];

export const figmaFetch: FetchLike = async (url, init) => {
  figmaCalls.push(url);
  const u = new URL(url);
  if (u.hostname === "img.test") {
    return new Response(u.pathname.startsWith("/svg") ? SVG : u.pathname.startsWith("/fill") ? JPEG : PNG);
  }
  if (init?.headers?.["X-Figma-Token"] !== "test-token") return json({ status: 403, err: "Invalid token" }, 403);
  if (u.pathname.includes("/DENIED")) return json({ status: 403, err: "Forbidden" }, 403);
  if (u.pathname.includes("/LIMITED")) return json({ status: 429, err: "Rate limit exceeded" }, 429, { "retry-after": "30" });
  if (u.pathname === "/v1/files/FILEKEY/nodes") {
    const id = u.searchParams.get("ids")!;
    return json({ name: "Campaign file", nodes: { [id]: id === "1:2" ? { document: FIGMA_FRAME } : null } });
  }
  if (u.pathname === "/v1/files/FILEKEY/images") return json({ meta: { images: { "img:ref/1": "https://img.test/fill/1" } } });
  if (u.pathname === "/v1/images/FILEKEY") {
    const format = u.searchParams.get("format")!;
    const ids = u.searchParams.get("ids")!.split(",");
    // Figma reports null for a node it could not render.
    return json({ err: null, images: Object.fromEntries(ids.map((id) => [id, id === "1:14" ? null : `https://img.test/${format}/${encodeURIComponent(id)}`])) });
  }
  return json({ status: 404, err: "Not found" }, 404);
};
