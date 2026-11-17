import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { AppError, type Config } from "@adengine/core";

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

export interface Storage {
  put(key: string, data: Buffer | Uint8Array): Promise<ObjectInfo>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

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

export function createStorage(config: Config["storage"]): Storage {
  return new LocalStorage(config.localDir);
}
