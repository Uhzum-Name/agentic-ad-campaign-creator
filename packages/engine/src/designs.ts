import { AppError, DesignDocument, type DesignSource, type Layer, newId } from "@adengine/core";
import { type Db, designDocuments, projects } from "@adengine/db";
import { fontStylesheetUrls, fontsUsed, summarizeDesign } from "@adengine/design";
import { FigmaClient, type FetchLike, convertFigmaFrame } from "@adengine/figma";
import type { Storage } from "@adengine/storage";
import { desc, eq } from "drizzle-orm";
import { FIXTURES } from "./fixtures.ts";

/* Design ingestion: every way a design document enters a project. */

export type DesignRow = typeof designDocuments.$inferSelect;

export interface DesignDeps {
  db: Db;
  storage: Storage;
}

async function requireProject(db: Db, projectId: string): Promise<void> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!row) throw AppError.notFound("Project", projectId);
}

export async function getDesign(db: Db, id: string): Promise<DesignRow> {
  const [row] = await db.select().from(designDocuments).where(eq(designDocuments.id, id));
  if (!row) throw AppError.notFound("Design", id);
  return row;
}

export async function listDesigns(db: Db, projectId: string): Promise<DesignRow[]> {
  await requireProject(db, projectId);
  return db.select().from(designDocuments).where(eq(designDocuments.projectId, projectId)).orderBy(desc(designDocuments.createdAt));
}

function validateDocument(input: unknown): DesignDocument {
  const parsed = DesignDocument.safeParse(input);
  if (!parsed.success) {
    throw new AppError("validation_error", "The design document is not valid", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const problems = summarizeDesign(parsed.data).problems;
  if (problems.length) throw new AppError("validation_error", "The design document is not valid", problems);
  return parsed.data;
}

async function insertDesign(
  db: Db,
  values: { id?: string; projectId: string; name: string; source: DesignSource; document: DesignDocument; referenceAssetKey?: string; importReport?: Record<string, unknown> },
): Promise<DesignRow> {
  const [row] = await db
    .insert(designDocuments)
    .values({ ...values, width: Math.round(values.document.width), height: Math.round(values.document.height) })
    .returning();
  if (!row) throw new Error("Failed to insert design");
  return row;
}

/** Stores a document supplied directly (by an agent or another tool). */
export async function createDesign({ db }: DesignDeps, input: { projectId: string; name: string; document: unknown }): Promise<DesignRow> {
  await requireProject(db, input.projectId);
  return insertDesign(db, { projectId: input.projectId, name: input.name, source: { kind: "manual" }, document: validateDocument(input.document) });
}

export function listFixtures() {
  return FIXTURES.map((f) => ({ name: f.name, title: f.title, description: f.description, width: f.document.width, height: f.document.height }));
}

/** Copies a built-in sample design, with its artwork, into a project. */
export async function importFixture({ db, storage }: DesignDeps, input: { projectId: string; fixture: string }): Promise<DesignRow> {
  await requireProject(db, input.projectId);
  const fixture = FIXTURES.find((f) => f.name === input.fixture);
  if (!fixture) throw new AppError("validation_error", `Unknown sample design "${input.fixture}"`, { available: FIXTURES.map((f) => f.name) });

  const id = newId("designDocument");
  const keys: Record<string, string> = {};
  for (const [file, source] of Object.entries(fixture.assets)) {
    keys[file] = `designs/${id}/${file}`;
    await storage.put(keys[file], Buffer.from(source), "image/svg+xml");
  }
  // Fixture layers are written without defaults; they are validated after resolving.
  const resolve = (layers: Layer[]): Layer[] =>
    layers.map((l) => {
      if (l.type === "group") return { ...l, children: resolve(l.children) };
      if (l.type !== "image") return l;
      const file = /^\{\{asset:(.+)\}\}$/.exec(l.assetKey)?.[1];
      const key = file ? keys[file] : undefined;
      if (!key) throw new Error(`Fixture ${fixture.name} references a missing asset: ${l.assetKey}`);
      return { ...l, assetKey: key };
    });
  const document = validateDocument({ ...fixture.document, layers: resolve(fixture.document.layers as Layer[]) });
  return insertDesign(db, { id, projectId: input.projectId, name: fixture.title, source: { kind: "fixture", name: fixture.name }, document });
}

function sniffContentType(data: Buffer): string {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  if (data.subarray(0, 4).toString() === "GIF8") return "image/gif";
  if (data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (/^\s*(<\?xml|<svg)/.test(data.subarray(0, 200).toString())) return "image/svg+xml";
  return "application/octet-stream";
}

export interface FigmaImportInput {
  projectId: string;
  fileKey: string;
  nodeId: string;
  name?: string;
}

/**
 * Imports one Figma frame. The Figma file is never modified; the result is a
 * new design document plus copies of its images in our storage, and Figma's
 * own render of the frame kept as a reference to compare against.
 */
export async function importFigmaDesign(
  { db, storage }: DesignDeps,
  figma: { token: string | undefined; fetch?: FetchLike },
  input: FigmaImportInput,
  onProgress: (fraction: number, message: string) => Promise<void> = async () => {},
): Promise<DesignRow> {
  if (!figma.token) {
    throw new AppError("validation_error", "Figma is not connected: no Figma access token is configured on the server (FIGMA_TOKEN).");
  }
  await requireProject(db, input.projectId);
  const client = new FigmaClient({ token: figma.token, ...(figma.fetch ? { fetch: figma.fetch } : {}) });
  const id = newId("designDocument");

  await onProgress(0.05, "Reading the frame from Figma");
  const { fileName, node } = await client.getNode(input.fileKey, input.nodeId);
  let conversion: ReturnType<typeof convertFigmaFrame>;
  try {
    conversion = convertFigmaFrame(node, { assetKeyFor: (name) => `designs/${id}/${name}` });
  } catch (err) {
    throw new AppError("validation_error", err instanceof Error ? err.message : String(err));
  }
  const { document, imageFills, rasters, report } = conversion;

  await onProgress(0.3, "Asking Figma for images");
  const fillUrls = imageFills.length ? await client.getImageFillUrls(input.fileKey) : {};
  const pngIds = rasters.filter((r) => r.format === "png").map((r) => r.nodeId);
  const svgIds = rasters.filter((r) => r.format === "svg").map((r) => r.nodeId);
  // Rasterised layers are rendered at 2× so they stay sharp; the reference at 1× to match our output.
  const pngUrls = await client.renderNodes(input.fileKey, pngIds, "png", 2);
  const svgUrls = await client.renderNodes(input.fileKey, svgIds, "svg");
  const referenceUrl = (await client.renderNodes(input.fileKey, [input.nodeId], "png", 1))[input.nodeId];

  const downloads: { key: string; url: string | null | undefined; label: string }[] = [
    ...imageFills.map((f) => ({ key: f.assetKey, url: fillUrls[f.imageRef], label: `image fill ${f.imageRef}` })),
    ...rasters.map((r) => ({ key: r.assetKey, url: (r.format === "png" ? pngUrls : svgUrls)[r.nodeId], label: `render of node ${r.nodeId}` })),
  ];
  const missing = new Set<string>();
  let done = 0;
  for (const d of downloads) {
    await onProgress(0.4 + 0.5 * (done++ / Math.max(1, downloads.length)), `Copying images (${done}/${downloads.length})`);
    if (!d.url) {
      missing.add(d.key);
      report.warnings.push(`Figma returned no file for ${d.label}; that layer was left out.`);
      continue;
    }
    const data = await client.download(d.url);
    await storage.put(d.key, data, sniffContentType(data));
  }

  let referenceAssetKey: string | undefined;
  if (referenceUrl) {
    referenceAssetKey = `designs/${id}/figma-reference.png`;
    await storage.put(referenceAssetKey, await client.download(referenceUrl), "image/png");
  } else {
    report.warnings.push("Figma returned no reference render of the frame.");
  }

  const prune = (layers: Layer[]): Layer[] =>
    layers.flatMap((l) => {
      if (l.type === "image" && missing.has(l.assetKey)) return [];
      return [l.type === "group" ? { ...l, children: prune(l.children) } : l];
    });

  await onProgress(0.92, "Checking fonts");
  report.warnings.push(...(await checkWebFonts(document, figma.fetch)));

  await onProgress(0.95, "Saving the design");
  return insertDesign(db, {
    id,
    projectId: input.projectId,
    name: input.name?.trim() || `${node.name} (${fileName})`,
    source: { kind: "figma", fileKey: input.fileKey, nodeId: input.nodeId },
    document: validateDocument({ ...document, layers: prune(document.layers) }),
    ...(referenceAssetKey ? { referenceAssetKey } : {}),
    importReport: report as unknown as Record<string, unknown>,
  });
}

/**
 * Fonts are loaded from Google Fonts by family name. A family it does not host
 * (typically a licensed brand font) falls back to a system font, so text may
 * look and wrap differently from the original. This says so up front.
 */
async function checkWebFonts(doc: DesignDocument, fetchImpl?: FetchLike): Promise<string[]> {
  const doFetch = fetchImpl ?? ((url: string) => fetch(url));
  const families = fontsUsed(doc).map((f) => f.family);
  const urls = fontStylesheetUrls(doc);
  const warnings: string[] = [];
  await Promise.all(
    families.map(async (family, i) => {
      try {
        const res = await doFetch(urls[i]!);
        if (res.status === 400 || res.status === 404) {
          warnings.push(`The font "${family}" is not available as a web font, so its text is shown in a substitute font and may wrap differently from Figma. Upload the font files to fix this.`);
        }
      } catch {
        warnings.push(`Could not check whether the font "${family}" is available as a web font.`);
      }
    }),
  );
  return warnings.sort();
}
