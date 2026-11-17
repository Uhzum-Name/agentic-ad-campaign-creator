import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { AppError, type Config } from "@adengine/core";
import { type Db, storedObjects } from "@adengine/db";
import { eq } from "drizzle-orm";

/**
 * Object storage for design assets and rendered deliverables. The interface
 * mirrors what an S3-compatible store offers, so an S3 driver can be added
 * without touching callers. Keys are slash-separated, e.g.
 * `projects/prj_x/assets/hero.png`.
 */
export interface ObjectInfo {
  key: string;
  bytes: number;
  sha256: string;
}

export interface StoredObject {
  data: Buffer;
  contentType: string;
}

export interface Storage {
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<ObjectInfo>;
  get(key: string): Promise<Buffer>;
  /** The object's bytes together with its content type. */
  read(key: string): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const TYPES_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  html: "text/html; charset=utf-8",
  json: "application/json",
  zip: "application/zip",
};

export function contentTypeForKey(key: string): string {
  return TYPES_BY_EXTENSION[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.split("/").some((part) => part === "." || part === "..")) {
    throw new AppError("validation_error", `Invalid storage key: ${JSON.stringify(key)}`);
  }
}

export class LocalStorage implements Storage {
  constructor(private readonly rootDir: string) {}

  private path(key: string): string {
    assertValidKey(key);
    const full = normalize(join(this.rootDir, key));
    if (!full.startsWith(normalize(this.rootDir) + sep)) {
      throw new AppError("validation_error", `Invalid storage key: ${JSON.stringify(key)}`);
    }
    return full;
  }

  async read(key: string): Promise<StoredObject> {
    return { data: await this.get(key), contentType: contentTypeForKey(key) };
  }

  async put(key: string, data: Buffer | Uint8Array): Promise<ObjectInfo> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    return { key, bytes: data.byteLength, sha256: createHash("sha256").update(data).digest("hex") };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw AppError.notFound("Stored object", key);
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.path(key))).isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

export class PostgresStorage implements Storage {
  constructor(private readonly db: Db) {}

  async put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<ObjectInfo> {
    assertValidKey(key);
    const buffer = Buffer.from(data);
    const row = {
      key,
      data: buffer,
      bytes: buffer.byteLength,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      contentType: contentType ?? contentTypeForKey(key),
    };
    await this.db.insert(storedObjects).values(row).onConflictDoUpdate({ target: storedObjects.key, set: row });
    return { key, bytes: row.bytes, sha256: row.sha256 };
  }

  async read(key: string): Promise<StoredObject> {
    assertValidKey(key);
    const [row] = await this.db.select({ data: storedObjects.data, contentType: storedObjects.contentType }).from(storedObjects).where(eq(storedObjects.key, key));
    if (!row) throw AppError.notFound("Stored object", key);
    return row;
  }

  async get(key: string): Promise<Buffer> {
    return (await this.read(key)).data;
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    const [row] = await this.db.select({ key: storedObjects.key }).from(storedObjects).where(eq(storedObjects.key, key));
    return row !== undefined;
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await this.db.delete(storedObjects).where(eq(storedObjects.key, key));
  }
}

export function createStorage(config: Config["storage"], db: Db): Storage {
  return config.driver === "local" ? new LocalStorage(config.localDir) : new PostgresStorage(db);
}
