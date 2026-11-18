import { loadConfig } from "@adengine/core/config";
import { type DbHandle, connect, migrate } from "@adengine/db";
import { createEngineRegistry } from "@adengine/engine";
import { JobSystem } from "@adengine/jobs";
import { PostgresStorage } from "@adengine/storage";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";

/*
 * The planning flow as an external agent performs it: through the MCP
 * endpoint over real HTTP, with the person's side (answers, approval) done
 * through the REST API as the web app does it.
 */

const config = loadConfig();
let handle: DbHandle;
let app: FastifyInstance;
let jobs: JobSystem;
let agent: Client;
let baseUrl: string;

async function rest(method: string, url: string, body?: unknown) {
  const res = await app.inject({ method: method as "GET", url: `/v1${url}`, payload: body as object });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

/** Calls a tool and returns its parsed JSON result, or the error object if the tool failed. */
async function tool(name: string, args: Record<string, unknown> = {}) {
  const res = (await agent.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  const text = res.content[0]!.text;
  // Input that fails the tool's schema is rejected by the SDK with a plain-text message.
  if (res.isError && !text.startsWith("{")) return { isError: true, message: text };
  const parsed = JSON.parse(text);
  return res.isError ? { isError: true, ...parsed } : parsed;
}

const plan = (overrides: Record<string, unknown> = {}) => ({
  objective: "Recruit veterans into Bank of America roles",
  audience: "US military veterans in transition, 25–45",
  messaging: ["Military skills are valued here", "10,000 new hires over five years"],
  directions: [
    { name: "Skills translate", concept: "Show how service skills map to banking roles", messagingAngle: "Your skills already fit", variationCount: 5, varyElements: ["headline", "cta"] },
    { name: "Family first", concept: "Stability for the family after service", messagingAngle: "A next chapter that strengthens everyone", variationCount: 3, varyElements: ["headline", "image"] },
  ],
  formats: [{ width: 300, height: 250 }, { width: 728, height: 90 }, { width: 970, height: 250 }],
  outputs: ["html5", "png"],
  workflow: ["Generate variations per direction", "Resize to all formats", "Export HTML5 and PNG"],
  ...overrides,
});

beforeAll(async () => {
  handle = connect(config.testDatabaseUrl!);
  await migrate(handle.db);
  await handle.db.execute(sql`truncate projects, jobs, recipes, stored_objects cascade`);
  const storage = new PostgresStorage(handle.db);
  jobs = new JobSystem({ db: handle.db, databaseUrl: config.testDatabaseUrl!, registry: createEngineRegistry({ db: handle.db, storage, figma: { token: undefined } }), mode: "inline" });
  app = buildApp({ db: handle.db, jobs, storage, config: {} });
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  agent = new Client({ name: "test-agent", version: "1.0.0" });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
});

afterAll(async () => {
  await agent?.close();
  await app?.close();
  await jobs?.stop();
  await handle?.close();
});

describe("MCP server", () => {
  it("describes itself and its tools", async () => {
    expect(agent.getInstructions()).toContain("get_campaign_context");
    const { tools } = await agent.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of [
      "list_projects", "create_project", "get_project", "update_project", "list_project_assets", "create_campaign", "get_campaign_context", "save_brief",
      "analyze_brief", "ask_clarifying_questions", "get_pending_input", "post_update", "generate_creative_plan", "approve_creative_plan",
      "import_figma_design", "add_sample_design", "inspect_design", "list_design_layers", "get_job_status", "cancel_job",
    ]) expect(names).toContain(expected);
    const planTool = tools.find((t) => t.name === "generate_creative_plan")!;
    expect(JSON.stringify(planTool.inputSchema)).toContain("varyElements");
    expect(tools.find((t) => t.name === "get_campaign_context")!.annotations?.readOnlyHint).toBe(true);
  });

  it("rejects GET with a JSON-RPC error", async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    expect(res.status).toBe(405);
  });

  it("runs brief → analysis → questions → plan → revision → approval", async () => {
    // Set-up, as the agent.
    const project = await tool("create_project", { name: "BoA Workforce" });
    const design = await tool("add_sample_design", { projectId: project.id, fixture: "trail-shoe-300x250" });
    const campaign = await tool("create_campaign", { projectId: project.id, name: "Veterans hiring" });
    await tool("save_brief", { campaignId: campaign.id, text: "Recruit veterans. Show that military skills matter at BoA." });

    let context = await tool("get_campaign_context", { campaignId: campaign.id });
    expect(context.brief).toMatchObject({ version: 1, analysis: null });
    expect(context.designs[0]).toMatchObject({ id: design.id, width: 300, height: 250 });
    expect(context.designs[0].roles.cta).toEqual(["cta"]);
    expect(context.designs[0].texts.map((t: { text: string }) => t.text)).toContain("Shop now");

    // Analysis, as structured data.
    const analysis = await tool("analyze_brief", {
      campaignId: campaign.id,
      analysis: { summary: "Recruit veterans by valuing their skills.", objective: "Applications from veterans", keyMessages: ["Your skills matter"], missingInformation: [{ topic: "Formats", why: "Determines layouts" }] },
    });
    expect(analysis.analysis).toMatchObject({ objective: "Applications from veterans", mandatories: [], constraints: [] });
    const badAnalysis = await tool("analyze_brief", { campaignId: campaign.id, analysis: { objective: "no summary" } });
    expect(badAnalysis).toMatchObject({ isError: true });
    expect(badAnalysis.message).toContain("summary");

    // Questions, answered by the person with one click.
    const asked = await tool("ask_clarifying_questions", {
      campaignId: campaign.id,
      questions: [
        { question: "Which sizes do you need?", options: ["Standard IAB set", "970×250 only"], allowOther: true, why: "Sets the layouts" },
        { question: "Is there a hiring page to link to?", options: ["Yes", "No"], allowOther: false },
      ],
    });
    expect(asked).toHaveLength(2);
    expect((await tool("get_pending_input", { campaignId: campaign.id })).length).toBe(0);
    expect((await rest("POST", `/messages/${asked[1].id}/answer`, { answer: "Maybe" })).status).toBe(400); // not an option
    await rest("POST", `/messages/${asked[0].id}/answer`, { answer: "Standard IAB set" });
    await rest("POST", `/messages/${asked[1].id}/answer`, { answer: "Yes" });
    await rest("POST", `/campaigns/${campaign.id}/messages`, { text: "Keep it respectful, no war imagery." });

    const peek = await tool("get_pending_input", { campaignId: campaign.id, markRead: false });
    expect(peek.map((p: { type: string }) => p.type)).toEqual(["answer", "answer", "message"]);
    const input = await tool("get_pending_input", { campaignId: campaign.id });
    expect(input[0]).toMatchObject({ type: "answer", question: "Which sizes do you need?", answer: "Standard IAB set" });
    expect(await tool("get_pending_input", { campaignId: campaign.id })).toEqual([]);

    // Plan v1, with validation on the way in.
    const invalid = await tool("generate_creative_plan", { campaignId: campaign.id, plan: plan({ directions: [] }) });
    expect(invalid).toMatchObject({ isError: true });
    expect(invalid.message).toContain("directions");
    const foreign = await tool("generate_creative_plan", {
      campaignId: campaign.id,
      plan: plan({ directions: [{ name: "X", concept: "c", messagingAngle: "m", variationCount: 1, varyElements: ["headline"], sourceDesignId: "dsn_elsewhere" }] }),
    });
    expect(foreign).toMatchObject({ isError: true, error: { code: "validation_error" } });

    const v1 = await tool("generate_creative_plan", { campaignId: campaign.id, plan: plan({ directions: plan().directions.map((d) => ({ ...d, sourceDesignId: design.id })) }) });
    expect(v1).toMatchObject({ version: 1, status: "proposed", briefVersion: 1, estimate: { directions: 2, variations: 8, sizes: 3, creatives: 24, files: 48 } });
    expect((await rest("GET", `/campaigns/${campaign.id}`)).body.data.status).toBe("planning");

    // The person requests changes; the agent sees it and revises.
    expect((await rest("POST", `/plans/${v1.id}/request-changes`, { feedback: "Add a direction about career growth." })).status).toBe(200);
    const decision = await tool("get_pending_input", { campaignId: campaign.id });
    expect(decision).toEqual([expect.objectContaining({ type: "plan_decision", planId: v1.id, text: "Requested changes to plan v1: Add a direction about career growth." })]);
    expect((await rest("POST", `/plans/${v1.id}/approve`, {})).status).toBe(409); // no longer approvable

    const v2 = await tool("generate_creative_plan", {
      campaignId: campaign.id,
      plan: plan({ directions: [...plan().directions, { name: "Room to grow", concept: "Career paths", messagingAngle: "Lead again", variationCount: 4, varyElements: ["headline", "layout"] }] }),
    });
    expect(v2).toMatchObject({ version: 2, estimate: { variations: 12 } });
    expect((await rest("GET", `/plans/${v1.id}`)).body.data.status).toBe("changes_requested");

    // A newer proposal supersedes an undecided one.
    const v3 = await tool("generate_creative_plan", { campaignId: campaign.id, plan: plan() });
    expect((await rest("GET", `/plans/${v2.id}`)).body.data.status).toBe("superseded");

    // The agent cannot approve without quoting an instruction.
    const noAuth = await rest("POST", `/plans/${v3.id}/approve`, { by: "agent" });
    expect(noAuth.status).toBe(400);

    // The person approves; directions appear.
    const approved = await rest("POST", `/plans/${v3.id}/approve`, {});
    expect(approved.status).toBe(200);
    expect(approved.body.data.directionIds).toHaveLength(2);
    context = await tool("get_campaign_context", { campaignId: campaign.id });
    expect(context.directions.map((d: { name: string; status: string; plannedVariations: number }) => [d.name, d.status, d.plannedVariations])).toEqual([
      ["Skills translate", "approved", 5],
      ["Family first", "approved", 3],
    ]);
    expect(context.latestPlan).toMatchObject({ version: 3, status: "approved", decidedBy: "user" });
    expect(context.pendingInput).toEqual([expect.objectContaining({ type: "plan_decision", text: "Approved plan v3." })]);

    // A later approved plan replaces earlier plan directions that have no variations.
    const v4 = await tool("generate_creative_plan", { campaignId: campaign.id, plan: plan({ directions: [plan().directions[0]] }) });
    await rest("POST", `/directions/${approved.body.data.directionIds[1]}/variations`, { name: "Kept" });
    const byAgent = await tool("approve_creative_plan", { planId: v4.id, instruction: "Go ahead and approve v4, thanks" });
    expect(byAgent.plan).toMatchObject({ status: "approved", decidedBy: "agent", decisionNote: "Go ahead and approve v4, thanks" });
    context = await tool("get_campaign_context", { campaignId: campaign.id });
    expect(context.directions.map((d: { name: string }) => d.name)).toEqual(["Family first", "Skills translate"]);
    expect(context.plans.map((p: { version: number; status: string }) => `${p.version}:${p.status}`)).toEqual(["4:approved", "3:superseded", "2:superseded", "1:changes_requested"]);

    // The thread tells the story in order.
    const thread = (await rest("GET", `/campaigns/${campaign.id}/messages`)).body.data.map((m: { role: string; kind: string }) => `${m.role}/${m.kind}`);
    expect(thread).toContain("agent/question");
    expect(thread.filter((k: string) => k === "agent/plan")).toHaveLength(4);
  });

  it("reports structured errors for unknown ids", async () => {
    expect(await tool("get_campaign_context", { campaignId: "cmp_missing" })).toMatchObject({ isError: true, error: { code: "not_found" } });
    expect(await tool("analyze_brief", { campaignId: "cmp_missing", analysis: { summary: "x" } })).toMatchObject({ isError: true, error: { code: "not_found" } });
    const project = await tool("create_project", { name: "No brief" });
    const campaign = await tool("create_campaign", { projectId: project.id, name: "C" });
    expect(await tool("analyze_brief", { campaignId: campaign.id, analysis: { summary: "x" } })).toMatchObject({ isError: true, error: { code: "conflict" } });
  });
});
