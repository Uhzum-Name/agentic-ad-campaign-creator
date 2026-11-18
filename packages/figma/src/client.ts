import { AppError } from "@adengine/core";

/*
 * A thin client for the documented Figma REST API (https://developers.figma.com/docs/rest-api/).
 * Only three endpoints are used:
 *   GET /v1/files/:key/nodes   — the node tree of a frame
 *   GET /v1/files/:key/images  — download URLs for image fills
 *   GET /v1/images/:key        — Figma's own render of nodes (PNG / SVG)
 * All three are in Figma's most rate-limited tier, so an import makes as few
 * calls as possible (one of each, plus one render call per output format).
 */

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export interface FigmaClientOptions {
  token: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  rotation?: number;
  isMask?: boolean;
  absoluteBoundingBox?: Box | null;
  absoluteRenderBounds?: Box | null;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  clipsContent?: boolean;
  effects?: { type: string; visible?: boolean }[];
  children?: FigmaNode[];
  characters?: string;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, FigmaTypeStyle>;
  style?: FigmaTypeStyle;
}
export interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  paragraphSpacing?: number;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  italic?: boolean;
  textCase?: string;
  textDecoration?: string;
  fills?: FigmaPaint[];
}
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}
export interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  gradientHandlePositions?: { x: number; y: number }[];
  gradientStops?: { position: number; color: FigmaColor }[];
  scaleMode?: string;
  imageRef?: string;
  /** For scaleMode STRETCH: [[a, b, tx], [c, d, ty]], the visible part of the image. */
  imageTransform?: number[][];
}

/** Accepts a Figma design link copied with "Copy link to selection". */
export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError("validation_error", "That is not a valid link. Paste a Figma link such as https://www.figma.com/design/…?node-id=1-2");
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) throw new AppError("validation_error", "The link must be a figma.com link.");
  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0];
  if (!kind || !["design", "file", "proto"].includes(kind) || !parts[1]) {
    throw new AppError("validation_error", "The link must point to a Figma design file (figma.com/design/…).");
  }
  // Branch links carry the branch key, which is the file to read.
  const fileKey = parts[2] === "branch" && parts[3] ? parts[3] : parts[1];
  const rawNode = url.searchParams.get("node-id");
  return { fileKey, ...(rawNode ? { nodeId: rawNode.replace(/-/g, ":") } : {}) };
}

export class FigmaClient {
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;

  constructor(private readonly opts: FigmaClientOptions) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = opts.baseUrl ?? "https://api.figma.com";
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}${path}`, { headers: { "X-Figma-Token": this.opts.token } });
    } catch (err) {
      throw new AppError("upstream_error", `Could not reach Figma: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.ok) return (await res.json()) as T;
    const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => "");
    if (res.status === 403) throw new AppError("unauthorized", "Figma refused access. Check that the Figma token is valid, has the file_content:read scope, and that its owner can open this file.", { figma: detail });
    if (res.status === 404) throw new AppError("not_found", "Figma could not find that file. Check the link.", { figma: detail });
    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      throw new AppError("rate_limited", `Figma's rate limit was reached.${retry ? ` Try again in ${retry} seconds.` : " Try again later."}`, { retryAfterSeconds: retry ? Number(retry) : undefined });
    }
    throw new AppError("upstream_error", `Figma returned an error (${res.status}).`, { figma: detail });
  }

  async getNode(fileKey: string, nodeId: string): Promise<{ fileName: string; node: FigmaNode }> {
    const body = await this.get<{ name: string; nodes: Record<string, { document: FigmaNode } | null> }>(
      `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`,
    );
    const entry = body.nodes[nodeId];
    if (!entry) throw new AppError("not_found", `The Figma file has no node ${nodeId}. Select a frame in Figma and copy its link again.`);
    return { fileName: body.name, node: entry.document };
  }

  /** imageRef → temporary download URL, for every image fill in the file. */
  async getImageFillUrls(fileKey: string): Promise<Record<string, string>> {
    const body = await this.get<{ meta?: { images?: Record<string, string> } }>(`/v1/files/${encodeURIComponent(fileKey)}/images`);
    return body.meta?.images ?? {};
  }

  /** node id → temporary URL of Figma's render, or null where Figma could not render it. */
  async renderNodes(fileKey: string, nodeIds: string[], format: "png" | "svg", scale = 1): Promise<Record<string, string | null>> {
    if (nodeIds.length === 0) return {};
    const body = await this.get<{ err?: string | null; images: Record<string, string | null> }>(
      `/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeIds.join(","))}&format=${format}${format === "png" ? `&scale=${scale}` : ""}`,
    );
    if (body.err) throw new AppError("upstream_error", `Figma could not render the design: ${body.err}`);
    return body.images;
  }

  /** Downloads a file from one of the temporary URLs Figma hands out. */
  async download(url: string): Promise<Buffer> {
    let res: Response;
    try {
      res = await this.fetch(url);
    } catch (err) {
      throw new AppError("upstream_error", `Could not download an image from Figma (${new URL(url).hostname}): ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new AppError("upstream_error", `Could not download an image from Figma (${new URL(url).hostname} returned ${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }
}
