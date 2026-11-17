import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "../src/index.ts";

let dir: string;
let storage: LocalStorage;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "adengine-storage-"));
  storage = new LocalStorage(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("LocalStorage", () => {
  it("round-trips objects and reports size and hash", async () => {
    const info = await storage.put("projects/prj_1/assets/a.txt", Buffer.from("hello"));
    expect(info.bytes).toBe(5);
    expect(info.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect((await storage.get("projects/prj_1/assets/a.txt")).toString()).toBe("hello");
    expect(await storage.exists("projects/prj_1/assets/a.txt")).toBe(true);
    await storage.delete("projects/prj_1/assets/a.txt");
    expect(await storage.exists("projects/prj_1/assets/a.txt")).toBe(false);
  });

  it("returns not_found for missing objects", async () => {
    await expect(storage.get("missing/file.bin")).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects keys that escape the storage root", async () => {
    for (const key of ["../outside.txt", "a/../../b", "/etc/passwd", "a//b", ""]) {
      await expect(storage.put(key, Buffer.from("x"))).rejects.toMatchObject({ code: "validation_error" });
    }
  });
});
