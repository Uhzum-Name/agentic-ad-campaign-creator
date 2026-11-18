import { AppError, newId } from "@adengine/core";
import { type Db, projectFonts, projects } from "@adengine/db";
import { FONT_CONTENT_TYPES, FONT_EXTENSIONS, FontParseError, parseFont } from "@adengine/fonts";
import type { Storage } from "@adengine/storage";
import { and, asc, eq, sql } from "drizzle-orm";

/* Brand fonts uploaded to a project. */

export type FontRow = typeof projectFonts.$inferSelect;

export const MAX_FONT_BYTES = 4 * 1024 * 1024;

export async function listFonts(db: Db, projectId: string): Promise<FontRow[]> {
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw AppError.notFound("Project", projectId);
  return db.select().from(projectFonts).where(eq(projectFonts.projectId, projectId)).orderBy(asc(projectFonts.family), asc(projectFonts.weight), asc(projectFonts.style));
}

/**
 * Stores a font file. Family, weight and style are read from the file; a
 * family name may be given to override what the file says (for a font whose
 * internal name differs from the name used in the designs). Uploading the same
 * face again replaces it.
 */
export async function uploadFont(
  { db, storage }: { db: Db; storage: Storage },
  input: { projectId: string; data: Buffer; fileName?: string; family?: string },
): Promise<{ font: FontRow; replaced: boolean }> {
  await listFonts(db, input.projectId);
  if (input.data.length === 0) throw new AppError("validation_error", "The file is empty.");
  if (input.data.length > MAX_FONT_BYTES) throw new AppError("validation_error", `The font file is larger than ${MAX_FONT_BYTES / 1024 / 1024} MB.`);
  let info: ReturnType<typeof parseFont>;
  try {
    info = parseFont(input.data);
  } catch (err) {
    if (err instanceof FontParseError) throw new AppError("validation_error", err.message);
    throw err;
  }
  const family = input.family?.trim() || info.family;
  if (family.length > 200) throw new AppError("validation_error", "The family name is too long.");

  const [existing] = await db
    .select()
    .from(projectFonts)
    .where(and(eq(projectFonts.projectId, input.projectId), sql`lower(${projectFonts.family}) = lower(${family})`, eq(projectFonts.weight, info.weight), eq(projectFonts.style, info.style)));

  const id = newId("font");
  const assetKey = `projects/${input.projectId}/fonts/${id}.${FONT_EXTENSIONS[info.format]}`;
  await storage.put(assetKey, input.data, FONT_CONTENT_TYPES[info.format]);
  const values = {
    family,
    weight: info.weight,
    style: info.style,
    format: info.format,
    assetKey,
    bytes: input.data.length,
    fileName: input.fileName?.slice(0, 255) ?? null,
  };
  let font: FontRow | undefined;
  if (existing) {
    [font] = await db.update(projectFonts).set(values).where(eq(projectFonts.id, existing.id)).returning();
    await storage.delete(existing.assetKey);
  } else {
    [font] = await db.insert(projectFonts).values({ id, projectId: input.projectId, ...values }).returning();
  }
  if (!font) throw new Error("Failed to save font");
  return { font, replaced: Boolean(existing) };
}

export async function deleteFont({ db, storage }: { db: Db; storage: Storage }, id: string): Promise<void> {
  const [font] = await db.select().from(projectFonts).where(eq(projectFonts.id, id));
  if (!font) throw AppError.notFound("Font", id);
  await db.delete(projectFonts).where(eq(projectFonts.id, id));
  await storage.delete(font.assetKey);
}
