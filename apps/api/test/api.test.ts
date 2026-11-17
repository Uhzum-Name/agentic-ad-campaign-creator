import { loadConfig } from "@adengine/core/config";
import { type DbHandle, connect, migrate } from "@adengine/db";
import { createEngineRegistry } from "@adengine/engine";
import { JobSystem } from "@adengine/jobs";
import { PostgresStorage, type Storage } from "@adengine/storage";
import { figmaFetch } from "./figma-fixture.ts";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";

const config = loadConfig();
if (!config.testDatabaseUrl) throw new Error("TEST_DATABASE_URL must be set to run integration tests");

let handle: DbHandle;
let jobs: JobSystem;
let storage: Storage;
let app: FastifyInstance;

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: method as "GET", url, payload: body as object, headers });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

async function waitForJob(id: string, done: (status: string) => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await call("GET", `/v1/jobs/${id}`);
    if (done(body.data.status)) return body.data;
    if (Date.now() > deadline) throw new Error(`job ${id} stuck in ${body.data.status}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  handle = connect(config.testDatabaseUrl!);
  await migrate(handle.db);
  await handle.db.execute(sql`truncate projects, jobs, recipes, stored_objects cascade`);
  storage = new PostgresStorage(handle.db);
  jobs = new JobSystem({
    db: handle.db,
    databaseUrl: config.testDatabaseUrl!,
    registry: createEngineRegistry({ db: handle.db, storage, figma: { token: "test-token", fetch: figmaFetch } }),
    pollingIntervalSeconds: 0.5,
  });
  await jobs.work(); // API and worker roles in one process for the test
  app = buildApp({ db: handle.db, jobs, storage, config: {} });
});

afterAll(async () => {
  await app?.close();
  await jobs?.stop();
  await handle?.close();
});

describe("projects and campaigns", () => {
  it("persists the project → campaign → brief hierarchy", async () => {
    const created = await call("POST", "/v1/projects", { name: "  Acme Running  ", description: "Spring launch" });
    expect(created.status).toBe(201);
    const project = created.body.data;
    expect(project.id).toMatch(/^prj_/);
    expect(project.name).toBe("Acme Running");

    const campaign = (await call("POST", `/v1/projects/${project.id}/campaigns`, { name: "Trail shoe launch" })).body.data;
    expect(campaign).toMatchObject({ projectId: project.id, status: "draft" });

    const list = await call("GET", "/v1/projects");
    expect(list.body.data.find((p: { id: string }) => p.id === project.id).campaignCount).toBe(1);

    expect((await call("PUT", `/v1/campaigns/${campaign.id}/brief`, { text: "Launch the new trail shoe." })).body.data.version).toBe(1);
    expect((await call("PUT", `/v1/campaigns/${campaign.id}/brief`, { text: "Launch it to weekend hikers." })).body.data.version).toBe(2);

    const fetched = (await call("GET", `/v1/campaigns/${campaign.id}`)).body.data;
    expect(fetched.brief).toMatchObject({ version: 2, text: "Launch it to weekend hikers." });
    expect((await call("GET", `/v1/campaigns/${campaign.id}/briefs`)).body.data).toHaveLength(2);

    const patched = await call("PATCH", `/v1/campaigns/${campaign.id}`, { status: "planning" });
    expect(patched.body.data.status).toBe("planning");
  });

  it("archives, hides and deletes projects, cascading to campaigns", async () => {
    const project = (await call("POST", "/v1/projects", { name: "Temp" })).body.data;
    const campaign = (await call("POST", `/v1/projects/${project.id}/campaigns`, { name: "C" })).body.data;

    await call("PATCH", `/v1/projects/${project.id}`, { archived: true });
    const visible = (await call("GET", "/v1/projects")).body.data.map((p: { id: string }) => p.id);
    expect(visible).not.toContain(project.id);
    const all = (await call("GET", "/v1/projects?includeArchived=true")).body.data.map((p: { id: string }) => p.id);
    expect(all).toContain(project.id);

    expect((await call("DELETE", `/v1/projects/${project.id}`)).status).toBe(204);
    expect((await call("GET", `/v1/campaigns/${campaign.id}`)).status).toBe(404);
  });

  it("returns structured errors", async () => {
    const invalid = await call("POST", "/v1/projects", { name: "" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("validation_error");
    expect(invalid.body.error.details[0].path).toBe("name");

    const missing = await call("GET", "/v1/projects/prj_doesnotexist");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toEqual({ code: "not_found", message: "Project prj_doesnotexist was not found" });

    expect((await call("PATCH", "/v1/campaigns/cmp_nope", { status: "bogus" })).status).toBe(400);
    expect((await call("GET", "/v1/nothing")).body.error.code).toBe("not_found");
  });
});

describe("authentication", () => {
  it("requires the bearer key when one is configured", async () => {
    const secured = buildApp({ db: handle.db, jobs, storage, config: { apiKey: "s3cret" } });
    const get = (headers: Record<string, string>) => secured.inject({ method: "GET", url: "/v1/projects", headers });
    expect((await get({})).statusCode).toBe(401);
    expect((await get({ authorization: "Bearer wrong!" })).statusCode).toBe(401);
    expect((await get({ authorization: "Bearer s3cret" })).statusCode).toBe(200);
    expect((await secured.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    await secured.close();
  });
});

describe("jobs", () => {
  it("runs a job in the background and reports progress and output", async () => {
    const submitted = await call("POST", "/v1/jobs", { type: "system.ping", input: { message: "hi", steps: 3, stepMs: 20 } });
    expect(submitted.status).toBe(202);
    expect(submitted.body.data.status).toBe("queued");
    const job = await waitForJob(submitted.body.data.id, (s) => s !== "queued" && s !== "running");
    expect(job).toMatchObject({ status: "succeeded", progress: 1, attempts: 1, output: { message: "hi", attempt: 1 } });
    expect(job.finishedAt).toBeTruthy();
  });

  it("retries a failing job and then succeeds", async () => {
    const { body } = await call("POST", "/v1/jobs", { type: "system.ping", input: { failUntilAttempt: 1 } });
    const job = await waitForJob(body.data.id, (s) => s === "succeeded" || s === "failed");
    expect(job).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  it("fails with a structured error once attempts are exhausted", async () => {
    const { body } = await call("POST", "/v1/jobs", { type: "system.ping", input: { failUntilAttempt: 10 } });
    const job = await waitForJob(body.data.id, (s) => s === "succeeded" || s === "failed", 60_000);
    expect(job).toMatchObject({ status: "failed", attempts: 3, error: { code: "internal_error", message: "Deliberate failure on attempt 3" } });
  }, 70_000);

  it("cancels a running job", async () => {
    const { body } = await call("POST", "/v1/jobs", { type: "system.ping", input: { steps: 100, stepMs: 100 } });
    await waitForJob(body.data.id, (s) => s === "running");
    await call("POST", `/v1/jobs/${body.data.id}/cancel`);
    const job = await waitForJob(body.data.id, (s) => s !== "running");
    expect(job.status).toBe("cancelled");
    expect(job.progress).toBeLessThan(1);
  });

  it("rejects unknown job types and invalid input", async () => {
    const unknown = await call("POST", "/v1/jobs", { type: "nope" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details.knownTypes).toContain("system.ping");
    expect((await call("POST", "/v1/jobs", { type: "system.ping", input: { steps: 0 } })).status).toBe(400);
    expect((await call("GET", "/v1/jobs/job_missing")).status).toBe(404);
  });
});

describe("workspace: directions, variations and the campaign thread", () => {
  it("builds the grid hierarchy and supports approval", async () => {
    const project = (await call("POST", "/v1/projects", { name: "Grid" })).body.data;
    const campaign = (await call("POST", `/v1/projects/${project.id}/campaigns`, { name: "Launch" })).body.data;

    const empty = (await call("GET", `/v1/campaigns/${campaign.id}/workspace`)).body.data;
    expect(empty).toMatchObject({ campaign: { id: campaign.id }, brief: null, directions: [] });

    const d1 = (await call("POST", `/v1/campaigns/${campaign.id}/directions`, { name: "Performance", messagingAngle: "Speed" })).body.data;
    const d2 = (await call("POST", `/v1/campaigns/${campaign.id}/directions`, { name: "Comfort" })).body.data;
    expect([d1.position, d2.position]).toEqual([0, 1]);
    expect(d1.status).toBe("proposed");

    const sizes = [{ width: 300, height: 250 }, { width: 728, height: 90, label: "Leaderboard" }];
    const v1 = (await call("POST", `/v1/directions/${d1.id}/variations`, { name: "Run further", sizes })).body.data;
    await call("POST", `/v1/directions/${d1.id}/variations`, { name: "Run faster" });
    expect(v1).toMatchObject({ campaignId: campaign.id, directionId: d1.id, status: "draft", position: 0 });
    expect(v1.formats.map((f: { width: number; height: number }) => `${f.width}x${f.height}`)).toEqual(["300x250", "728x90"]);

    expect((await call("PATCH", `/v1/variations/${v1.id}`, { status: "approved" })).body.data.status).toBe("approved");
    expect((await call("PATCH", `/v1/directions/${d2.id}`, { status: "rejected" })).body.data.status).toBe("rejected");

    const ws = (await call("GET", `/v1/campaigns/${campaign.id}/workspace`)).body.data;
    expect(ws.directions.map((d: { name: string }) => d.name)).toEqual(["Performance", "Comfort"]);
    expect(ws.directions[0].variations.map((v: { name: string; status: string }) => [v.name, v.status])).toEqual([
      ["Run further", "approved"],
      ["Run faster", "draft"],
    ]);
    expect(ws.directions[0].variations[0].formats).toHaveLength(2);
    expect(ws.directions[1].variations).toEqual([]);

    expect((await call("DELETE", `/v1/directions/${d1.id}`)).status).toBe(204);
    expect((await call("PATCH", `/v1/variations/${v1.id}`, { status: "ready" })).status).toBe(404);
  });

  it("validates variation input", async () => {
    const project = (await call("POST", "/v1/projects", { name: "V" })).body.data;
    const campaign = (await call("POST", `/v1/projects/${project.id}/campaigns`, { name: "C" })).body.data;
    const d = (await call("POST", `/v1/campaigns/${campaign.id}/directions`, { name: "D" })).body.data;
    const dup = await call("POST", `/v1/directions/${d.id}/variations`, { name: "x", sizes: [{ width: 1, height: 1 }, { width: 1, height: 1 }] });
    expect(dup.status).toBe(400);
    expect((await call("POST", `/v1/directions/${d.id}/variations`, { name: "x", sourceDesignId: "dsn_missing" })).status).toBe(404);
    expect((await call("PATCH", `/v1/variations/var_missing`, { status: "nope" })).status).toBe(400);
    expect((await call("POST", `/v1/directions/dir_missing/variations`, { name: "x" })).status).toBe(404);
  });

  it("keeps a thread where user direction waits until an agent acknowledges it", async () => {
    const project = (await call("POST", "/v1/projects", { name: "Thread" })).body.data;
    const campaign = (await call("POST", `/v1/projects/${project.id}/campaigns`, { name: "C" })).body.data;
    const base = `/v1/campaigns/${campaign.id}/messages`;

    const note = (await call("POST", base, { text: "Make the CTA bolder" })).body.data;
    expect(note).toMatchObject({ role: "user", kind: "message", acknowledgedAt: null });
    expect((await call("GET", `${base}?pending=true`)).body.data).toHaveLength(1);

    const acked = (await call("POST", `/v1/messages/${note.id}/acknowledge`)).body.data;
    expect(acked.acknowledgedAt).toBeTruthy();
    expect((await call("POST", `/v1/messages/${note.id}/acknowledge`)).body.data.acknowledgedAt).toBe(acked.acknowledgedAt);
    expect((await call("GET", `${base}?pending=true`)).body.data).toHaveLength(0);

    const activity = (await call("POST", base, { text: "Generated 5 variations", role: "agent", kind: "activity" })).body.data;
    expect(activity).toMatchObject({ role: "agent", kind: "activity" });
    expect((await call("POST", `/v1/messages/${activity.id}/acknowledge`)).status).toBe(400);
    expect((await call("POST", base, { text: "x", role: "user", kind: "activity" })).status).toBe(400);
    expect((await call("POST", base, { text: "x", role: "system" })).status).toBe(400);

    expect((await call("GET", base)).body.data.map((m: { text: string }) => m.text)).toEqual(["Make the CTA bolder", "Generated 5 variations"]);
  });
});

describe("designs", () => {
  async function newProject() {
    return (await call("POST", "/v1/projects", { name: "Designs" })).body.data as { id: string };
  }

  it("imports a sample design with its artwork and exposes its layers", async () => {
    const project = await newProject();
    const fixtures = (await call("GET", "/v1/design-fixtures")).body.data;
    expect(fixtures.map((f: { name: string }) => f.name)).toEqual(["trail-shoe-300x250", "coffee-728x90"]);

    const created = await call("POST", `/v1/projects/${project.id}/designs/from-fixture`, { fixture: "trail-shoe-300x250" });
    expect(created.status).toBe(201);
    const design = created.body.data;
    expect(design).toMatchObject({ width: 300, height: 250, source: { kind: "fixture", name: "trail-shoe-300x250" } });

    const detail = (await call("GET", `/v1/designs/${design.id}`)).body.data;
    expect(detail.summary).toMatchObject({ layerCount: 8, byType: { text: 3, image: 3, shape: 1, group: 1 }, fonts: ["Inter"] });
    expect(Object.keys(detail.summary.roles).sort()).toEqual(["background", "cta", "headline", "logo", "product", "subheadline"]);

    const layers = (await call("GET", `/v1/designs/${design.id}/layers`)).body.data;
    expect(layers.map((l: { id: string }) => l.id)).toEqual(["background", "logo", "headline", "subheadline", "product", "cta", "cta-background", "cta-label"]);
    expect((await call("GET", `/v1/designs/${design.id}/layers?type=text`)).body.data.map((l: { text: string }) => l.text)).toContain("Shop now");
    expect((await call("GET", `/v1/designs/${design.id}/layers?role=cta`)).body.data).toHaveLength(1);
    expect((await call("GET", `/v1/designs/${design.id}/layers?role=bogus`)).status).toBe(400);

    const label = (await call("GET", `/v1/designs/${design.id}/layers/cta-label`)).body.data;
    expect(label).toMatchObject({ absoluteX: 16, absoluteY: 198, path: ["cta"], layer: { type: "text", text: "Shop now", style: { fontWeight: 700 } } });
    expect((await call("GET", `/v1/designs/${design.id}/layers/nope`)).status).toBe(404);

    // The artwork was copied into storage and is served with a safe content type.
    const product = layers.find((l: { id: string }) => l.id === "product");
    expect(product.assetKey).toBe(`designs/${design.id}/shoe.svg`);
    const asset = await app.inject({ method: "GET", url: `/v1/assets/${product.assetKey}` });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toBe("image/svg+xml");
    expect(asset.headers["content-security-policy"]).toContain("sandbox");
    expect(asset.body.startsWith("<svg")).toBe(true);
    expect((await call("GET", "/v1/assets/designs/missing/file.png")).status).toBe(404);
    expect((await call("GET", "/v1/assets/..%2F..%2Fetc%2Fpasswd")).status).toBe(400);

    expect((await call("GET", `/v1/projects/${project.id}/designs`)).body.data).toHaveLength(1);
    expect((await call("POST", `/v1/projects/${project.id}/designs/from-fixture`, { fixture: "nope" })).status).toBe(400);
  });

  it("accepts a document directly and validates it", async () => {
    const project = await newProject();
    const document = { schemaVersion: 1, width: 320, height: 50, layers: [{ id: "t", type: "text", name: "T", x: 0, y: 0, width: 320, height: 50, text: "Hi", style: { fontFamily: "Inter", fontSize: 20, color: "#000" } }] };
    const ok = await call("POST", `/v1/projects/${project.id}/designs`, { name: "Mobile banner", document });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ width: 320, height: 50, source: { kind: "manual" } });

    const bad = await call("POST", `/v1/projects/${project.id}/designs`, { name: "Bad", document: { ...document, layers: [{ id: "x", type: "video" }] } });
    expect(bad.status).toBe(400);
    const dup = await call("POST", `/v1/projects/${project.id}/designs`, { name: "Dup", document: { ...document, layers: [document.layers[0], document.layers[0]] } });
    expect(dup.status).toBe(400);
    expect(dup.body.error.details).toEqual(["Duplicate layer id t"]);
  });

  it("renders variations from their source design and protects designs in use", async () => {
    const project = await newProject();
    const campaign = (await call("POST", `/v1/projects/${project.id}/campaigns`, { name: "C" })).body.data;
    const design = (await call("POST", `/v1/projects/${project.id}/designs/from-fixture`, { fixture: "coffee-728x90" })).body.data;
    const direction = (await call("POST", `/v1/campaigns/${campaign.id}/directions`, { name: "D" })).body.data;
    const variation = (await call("POST", `/v1/directions/${direction.id}/variations`, { name: "V", sourceDesignId: design.id })).body.data;

    const ws = (await call("GET", `/v1/campaigns/${campaign.id}/workspace`)).body.data;
    expect(Object.keys(ws.designs)).toEqual([design.id]);
    expect(ws.designs[design.id].document.width).toBe(728);

    const blocked = await call("DELETE", `/v1/designs/${design.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain("1 variation");
    await call("DELETE", `/v1/variations/${variation.id}`);
    expect((await call("DELETE", `/v1/designs/${design.id}`)).status).toBe(204);
  });

  it("imports a Figma frame through a background job", async () => {
    const project = await newProject();
    const submitted = await call("POST", `/v1/projects/${project.id}/designs/import-figma`, { url: "https://www.figma.com/design/FILEKEY/Campaign?node-id=1-2" });
    expect(submitted.status).toBe(202);
    const job = await waitForJob(submitted.body.data.id, (s) => s !== "queued" && s !== "running");
    expect(job.status).toBe("succeeded");
    expect(job.output).toMatchObject({ name: "Banner 300x250 (Campaign file)", width: 300, height: 250 });

    const design = (await call("GET", `/v1/designs/${job.output.designId}`)).body.data;
    expect(design.source).toEqual({ kind: "figma", fileKey: "FILEKEY", nodeId: "1:2" });
    expect(design.referenceAssetKey).toBe(`designs/${design.id}/figma-reference.png`);
    // The node Figma could not render was left out and reported.
    expect(design.document.layers.map((l: { name: string }) => l.name)).not.toContain("Broken star");
    expect(design.importReport.warnings.join(" ")).toContain("render of node 1:14");
    expect(design.summary.texts.map((t: { text: string }) => t.text)).toEqual(["Go further", "Built for the long way round.", "Shop now", "draft"]);

    const types: Record<string, string> = {};
    for (const key of [`designs/${design.id}/fill-imgref1`, `designs/${design.id}/node-1_9.svg`, `designs/${design.id}/node-1_10.png`, design.referenceAssetKey]) {
      types[key.split("/").pop()!] = String((await app.inject({ method: "GET", url: `/v1/assets/${key}` })).headers["content-type"]);
    }
    expect(types).toEqual({ "fill-imgref1": "image/jpeg", "node-1_9.svg": "image/svg+xml", "node-1_10.png": "image/png", "figma-reference.png": "image/png" });
  });

  it("explains Figma failures", async () => {
    const project = await newProject();
    const run = async (body: object) => {
      const res = await call("POST", `/v1/projects/${project.id}/designs/import-figma`, body);
      return res.status === 202 ? waitForJob(res.body.data.id, (s) => s !== "queued" && s !== "running") : res;
    };
    expect(await run({ fileKey: "DENIED", nodeId: "1:2" })).toMatchObject({ status: "failed", error: { code: "unauthorized" } });
    expect(await run({ fileKey: "LIMITED", nodeId: "1:2" })).toMatchObject({ status: "failed", error: { code: "rate_limited", message: "Figma's rate limit was reached. Try again in 30 seconds." } });
    expect(await run({ fileKey: "FILEKEY", nodeId: "9:9" })).toMatchObject({ status: "failed", error: { code: "not_found" } });
    const noNode = await run({ url: "https://www.figma.com/design/FILEKEY/Campaign" });
    expect(noNode).toMatchObject({ status: 400 });
    expect((noNode as { body: { error: { message: string } } }).body.error.message).toContain("Copy link to selection");
    expect(await run({ url: "https://example.com/x" })).toMatchObject({ status: 400 });
    expect(await run({})).toMatchObject({ status: 400 });
    expect((await call("POST", "/v1/projects/prj_missing/designs/import-figma", { fileKey: "FILEKEY", nodeId: "1:2" })).status).toBe(404);
  });
});

describe("inline job mode", () => {
  it("runs a job to completion inside submit, with retries, and no queue", async () => {
    const inline = new JobSystem({ db: handle.db, databaseUrl: "postgres://unused:unused@127.0.0.1:1/none", registry: createEngineRegistry({ db: handle.db, storage, figma: { token: undefined } }), mode: "inline" });
    const ok = await inline.submit("system.ping", { message: "inline", failUntilAttempt: 1 });
    expect(ok).toMatchObject({ status: "succeeded", attempts: 2, output: { message: "inline", attempt: 2 } });
    const failed = await inline.submit("system.ping", { failUntilAttempt: 10 });
    expect(failed).toMatchObject({ status: "failed", attempts: 3 });
    const project = (await call("POST", "/v1/projects", { name: "Inline" })).body.data;
    const noToken = await inline.submit("design.import_figma", { projectId: project.id, fileKey: "FILEKEY", nodeId: "1:2" });
    expect(noToken).toMatchObject({ status: "failed", error: { code: "validation_error" } });
    expect(noToken.error!.message).toContain("FIGMA_TOKEN");
    await inline.stop();
  });
});
