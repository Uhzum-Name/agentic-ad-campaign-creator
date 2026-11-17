import { loadConfig } from "@adengine/core";
import { type DbHandle, connect, migrate } from "@adengine/db";
import { JobSystem, createDefaultRegistry } from "@adengine/jobs";
import { LocalStorage } from "@adengine/storage";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";

const config = loadConfig();
if (!config.testDatabaseUrl) throw new Error("TEST_DATABASE_URL must be set to run integration tests");

let handle: DbHandle;
let jobs: JobSystem;
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
  await handle.db.execute(sql`truncate projects, jobs, recipes cascade`);
  jobs = new JobSystem({
    db: handle.db,
    databaseUrl: config.testDatabaseUrl!,
    registry: await createDefaultRegistry(),
    pollingIntervalSeconds: 0.5,
  });
  await jobs.work(); // API and worker roles in one process for the test
  app = buildApp({ db: handle.db, jobs, storage: new LocalStorage("/tmp/unused"), config: {} });
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
    const secured = buildApp({ db: handle.db, jobs, storage: new LocalStorage("/tmp/unused"), config: { apiKey: "s3cret" } });
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
