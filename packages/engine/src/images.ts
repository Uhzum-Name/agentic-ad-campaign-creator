import { AppError, newId } from "@adengine/core";
import { type Db, designDocuments, projectImages, projects } from "@adengine/db";
import type { Storage } from "@adengine/storage";
import { and, desc, eq, inArray } from "drizzle-orm";

/* The project image library: pictures that can be swapped into variations. */

export type ImageRow = typeof projectImages.$inferSelect;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" } as const;
type Ext = keyof typeof TYPES;

/** Identifies the format from the file's bytes and reads its pixel size where the format states one. */
export function sniffImage(data: Buffer): { ext: Ext; width?: number; height?: number } | undefined {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let p = 2;
    while (p + 9 < data.length) {
      if (data[p] !== 0xff) {
        p++;
        continue;
      }
      const marker = data[p + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { ext: "jpg", height: data.readUInt16BE(p + 5), width: data.readUInt16BE(p + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2;
        continue;
      }
      p += 2 + data.readUInt16BE(p + 2);
    }
    return { ext: "jpg" };
  }
  if (data.length >= 10 && data.subarray(0, 4).toString("latin1") === "GIF8") return { ext: "gif", width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  if (data.length >= 30 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") {
    const chunk = data.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X") return { ext: "webp", width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (chunk === "VP8L") {
      const b = data.readUInt32LE(21);
      return { ext: "webp", width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") return { ext: "webp", width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    return { ext: "webp" };
  }
  const head = data.subarray(0, 2000).toString("utf8");
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) {
    const tag = /<svg[^>]*>/i.exec(head)?.[0] ?? "";
    const num = (name: string) => {
      const m = new RegExp(`\\s${name}="([0-9.]+)(px)?"`, "i").exec(tag);
      return m ? Math.round(Number(m[1])) : undefined;
    };
    const vb = /viewBox="[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)"/i.exec(tag);
    const width = num("width") ?? (vb ? Math.round(Number(vb[1])) : undefined);
    const height = num("height") ?? (vb ? Math.round(Number(vb[2])) : undefined);
    return { ext: "svg", ...(width ? { width } : {}), ...(height ? { height } : {}) };
  }
  return undefined;
}

async function requireProject(db: Db, projectId: string): Promise<void> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!row) throw AppError.notFound("Project", projectId);
}

export async function listImages(db: Db, projectId: string): Promise<ImageRow[]> {
  await requireProject(db, projectId);
  return db.select().from(projectImages).where(eq(projectImages.projectId, projectId)).orderBy(desc(projectImages.createdAt));
}

export async function uploadImage({ db, storage }: { db: Db; storage: Storage }, input: { projectId: string; data: Buffer; name?: string }): Promise<ImageRow> {
  await requireProject(db, input.projectId);
  if (input.data.length === 0) throw new AppError("validation_error", "The file is empty.");
  if (input.data.length > MAX_IMAGE_BYTES) throw new AppError("validation_error", `The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  const info = sniffImage(input.data);
  if (!info) throw new AppError("validation_error", "This is not a supported image. Upload a PNG, JPEG, GIF, WebP or SVG file.");
  const id = newId("image");
  const assetKey = `projects/${input.projectId}/images/${id}.${info.ext}`;
  await storage.put(assetKey, input.data, TYPES[info.ext]);
  const name = (input.name?.trim() || `${id}.${info.ext}`).slice(0, 200);
  const [row] = await db
    .insert(projectImages)
    .values({ id, projectId: input.projectId, name, assetKey, contentType: TYPES[info.ext], bytes: input.data.length, width: info.width ?? null, height: info.height ?? null })
    .returning();
  return row!;
}

export async function deleteImage({ db, storage }: { db: Db; storage: Storage }, id: string): Promise<void> {
  const [row] = await db.select().from(projectImages).where(eq(projectImages.id, id));
  if (!row) throw AppError.notFound("Image", id);
  await db.delete(projectImages).where(eq(projectImages.id, id));
  await storage.delete(row.assetKey);
}

/**
 * Which of `keys` a variation in this project may not use: anything that is
 * not a project image or an image belonging to one of the project's designs.
 */
export async function foreignAssetKeys(db: Db, projectId: string, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const images = await db.select({ key: projectImages.assetKey }).from(projectImages).where(and(eq(projectImages.projectId, projectId), inArray(projectImages.assetKey, keys)));
  const allowed = new Set(images.map((i) => i.key));
  const designIds = [...new Set(keys.map((k) => /^designs\/(dsn_[a-z0-9]+)\//.exec(k)?.[1]).filter((v): v is string => Boolean(v)))];
  if (designIds.length) {
    const designs = await db.select({ id: designDocuments.id }).from(designDocuments).where(and(eq(designDocuments.projectId, projectId), inArray(designDocuments.id, designIds)));
    const own = new Set(designs.map((d) => d.id));
    for (const k of keys) if (own.has(/^designs\/(dsn_[a-z0-9]+)\//.exec(k)?.[1] ?? "")) allowed.add(k);
  }
  return keys.filter((k) => !allowed.has(k));
}
