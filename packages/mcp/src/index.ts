import { AskQuestionsInput, BriefAnalysis, CreativePlan, SEMANTIC_ROLES } from "@adengine/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/*
 * The MCP server: how an external agent (Claude Code, the Claude apps, any
 * MCP client) operates the engine. Every tool is a thin call to the REST API,
 * so the agent and the web app share one set of rules and validation.
 */

export interface ApiResponse {
  status: number;
  body: unknown;
}
/** Performs a REST call against /v1 (e.g. via Fastify inject). */
export type ApiCaller = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<ApiResponse>;

export const SERVER_INSTRUCTIONS = `This server is a creative production engine for advertising. You are the agent that plans and directs the work; a person supervises in a web workspace, where everything you do appears live.

How to work on a campaign:
1. Call get_campaign_context first, and again whenever you resume. It returns the brief, its analysis, the designs you can build from (with each layer's role and text), directions, plans, and pendingInput: what the person has said that you have not picked up.
2. Read the brief and record your structured reading with analyze_brief. List what it does not say in missingInformation.
3. If anything important is missing, call ask_clarifying_questions with one-click options. Do not guess at objective, audience, offer or required sizes when the answer would change the plan. Then call get_pending_input until the answers arrive; the person answers in the workspace.
4. Propose a structured plan with generate_creative_plan. Base directions on the project's designs (sourceDesignId) when there are any, choose what varies per direction, and list the sizes and outputs.
5. Wait for the person's decision: poll get_pending_input. A plan_decision says "Approved plan vN" or "Requested changes to plan vN: ...". On changes, propose a revised plan; it becomes the next version.
6. Only call approve_creative_plan yourself if the person explicitly told you to approve on their behalf, and quote their words.
Use post_update to tell the person what you are doing or to answer them; keep updates short. Long-running work returns a job; check it with get_job_status.
Errors come back with a code (validation_error, not_found, conflict, unauthorized, rate_limited, upstream_error) and a message saying what to fix.`;

interface ToolConfig {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

function result(res: ApiResponse) {
  const body = res.body as { data?: unknown; error?: { code: string; message: string; details?: unknown } } | undefined;
  if (res.status >= 400) {
    const err = body?.error ?? { code: "internal_error", message: `Request failed (${res.status})` };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: err }, null, 2) }] };
  }
  const data = res.status === 204 ? { ok: true } : body?.data;
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const id = (what: string, prefix: string) => z.string().min(1).describe(`${what} id (${prefix}_...)`);

export function createMcpServer(call: ApiCaller): McpServer {
  const server = new McpServer({ name: "creative-engine", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });
  // The SDK's generic signature does not survive this wrapper; inputs are validated by the SDK against inputSchema.
  // biome-ignore lint/suspicious/noExplicitAny: see above
  const tool = (name: string, config: ToolConfig, handler: (args: any) => Promise<ApiResponse>) =>
    // biome-ignore lint/suspicious/noExplicitAny: see above
    (server.registerTool as any)(name, config, async (args: unknown) => result(await handler(args)));
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  // ---- projects
  tool("list_projects", { title: "List projects", description: "Lists projects with their campaign counts.", inputSchema: {}, annotations: readOnly }, () => call("GET", "/projects"));
  tool(
    "create_project",
    { title: "Create project", description: "Creates a project: the container for one brand or client.", inputSchema: { name: z.string().min(1).max(200), description: z.string().max(5000).optional() } },
    (a) => call("POST", "/projects", a),
  );
  tool("get_project", { title: "Get project", description: "A project and its campaigns.", inputSchema: { projectId: id("Project", "prj") }, annotations: readOnly }, async (a) => {
    const project = await call("GET", `/projects/${a.projectId}`);
    if (project.status >= 400) return project;
    const campaigns = await call("GET", `/projects/${a.projectId}/campaigns`);
    return { status: 200, body: { data: { ...(project.body as { data: object }).data, campaigns: (campaigns.body as { data: unknown }).data } } };
  });
  tool(
    "update_project",
    { title: "Update project", description: "Renames, re-describes, or archives a project.", inputSchema: { projectId: id("Project", "prj"), name: z.string().min(1).max(200).optional(), description: z.string().max(5000).optional(), archived: z.boolean().optional() } },
    ({ projectId, ...rest }) => call("PATCH", `/projects/${projectId}`, rest),
  );
  tool(
    "list_project_assets",
    { title: "List project assets", description: "The project's source designs (with how many variations use each) and uploaded brand fonts.", inputSchema: { projectId: id("Project", "prj") }, annotations: readOnly },
    async (a) => {
      const designs = await call("GET", `/projects/${a.projectId}/designs`);
      if (designs.status >= 400) return designs;
      const fonts = await call("GET", `/projects/${a.projectId}/fonts`);
      const list = (designs.body as { data: { id: string; name: string; width: number; height: number; source: unknown; usageCount: number }[] }).data;
      return {
        status: 200,
        body: { data: { designs: list.map(({ id, name, width, height, source, usageCount }) => ({ id, name, width, height, source, usageCount })), fonts: (fonts.body as { data: unknown }).data } },
      };
    },
  );

  // ---- campaigns and briefs
  tool(
    "create_campaign",
    { title: "Create campaign", description: "Creates a campaign in a project.", inputSchema: { projectId: id("Project", "prj"), name: z.string().min(1).max(200), objective: z.string().max(5000).optional() } },
    ({ projectId, ...rest }) => call("POST", `/projects/${projectId}/campaigns`, rest),
  );
  tool(
    "get_campaign_context",
    {
      title: "Get campaign context",
      description: "Everything needed to work on a campaign: brief and analysis, designs with layer roles and text, fonts, directions, plans, recent thread, and pendingInput (what the person said that you have not picked up). Does not mark anything as read.",
      inputSchema: { campaignId: id("Campaign", "cmp") },
      annotations: readOnly,
    },
    (a) => call("GET", `/campaigns/${a.campaignId}/context`),
  );
  tool(
    "save_brief",
    { title: "Save brief", description: "Saves the campaign brief as a new version. Use when the person gives you the brief in conversation.", inputSchema: { campaignId: id("Campaign", "cmp"), text: z.string().min(1).max(50_000) } },
    (a) => call("PUT", `/campaigns/${a.campaignId}/brief`, { text: a.text }),
  );

  // ---- strategy
  tool(
    "analyze_brief",
    {
      title: "Record brief analysis",
      description: "Records your structured reading of the current brief: objective, audience, messages, mandatories, constraints, and missingInformation. Shown to the person in the Brief tab.",
      inputSchema: { campaignId: id("Campaign", "cmp"), analysis: BriefAnalysis },
    },
    (a) => call("PUT", `/campaigns/${a.campaignId}/brief/analysis`, a.analysis),
  );
  tool(
    "ask_clarifying_questions",
    {
      title: "Ask clarifying questions",
      description: "Asks the person questions with one-click answer options; they appear in the workspace's agent panel. Collect the answers with get_pending_input.",
      inputSchema: { campaignId: id("Campaign", "cmp"), questions: AskQuestionsInput.shape.questions },
    },
    (a) => call("POST", `/campaigns/${a.campaignId}/questions`, { questions: a.questions }),
  );
  tool(
    "get_pending_input",
    {
      title: "Get pending input",
      description: "Returns what the person has said since you last checked: messages, answers to your questions, and plan decisions. By default marks them as picked up, which the person sees.",
      inputSchema: { campaignId: id("Campaign", "cmp"), markRead: z.boolean().default(true) },
    },
    (a) => call("GET", `/campaigns/${a.campaignId}/pending-input?markRead=${a.markRead !== false}`),
  );
  tool(
    "post_update",
    {
      title: "Post update",
      description: "Posts to the campaign's agent panel. kind 'message' for replies to the person, 'activity' for short progress notes.",
      inputSchema: { campaignId: id("Campaign", "cmp"), text: z.string().min(1).max(20_000), kind: z.enum(["message", "activity"]).default("message") },
    },
    (a) => call("POST", `/campaigns/${a.campaignId}/messages`, { role: "agent", kind: a.kind ?? "message", text: a.text }),
  );
  tool(
    "generate_creative_plan",
    {
      title: "Propose creative plan",
      description: "Submits a structured creative plan for the person to approve: objective, audience, messaging, directions (each with what varies and how many variations), formats, outputs and workflow. Returns the stored plan with a production estimate. Each call creates the next version.",
      inputSchema: { campaignId: id("Campaign", "cmp"), plan: CreativePlan },
    },
    (a) => call("POST", `/campaigns/${a.campaignId}/plans`, a.plan),
  );
  tool(
    "approve_creative_plan",
    {
      title: "Approve creative plan",
      description: "Approves a proposed plan on the person's behalf and creates its directions. Only use when the person explicitly told you to; quote their instruction. Normally the person approves in the workspace.",
      inputSchema: { planId: id("Plan", "pln"), instruction: z.string().min(1).max(2000).describe("The person's words authorising approval") },
    },
    (a) => call("POST", `/plans/${a.planId}/approve`, { by: "agent", note: a.instruction }),
  );

  // ---- designs
  tool(
    "import_figma_design",
    { title: "Import Figma design", description: "Imports one Figma frame into a project from a link copied with 'Copy link to selection'. Returns a job; when it succeeds its output has designId.", inputSchema: { projectId: id("Project", "prj"), url: z.string().url(), name: z.string().max(200).optional() } },
    ({ projectId, ...rest }) => call("POST", `/projects/${projectId}/designs/import-figma`, rest),
  );
  tool(
    "add_sample_design",
    { title: "Add sample design", description: "Adds a built-in sample design to a project (for trying the engine without Figma).", inputSchema: { projectId: id("Project", "prj"), fixture: z.enum(["trail-shoe-300x250", "coffee-728x90"]) } },
    (a) => call("POST", `/projects/${a.projectId}/designs/from-fixture`, { fixture: a.fixture }),
  );
  tool(
    "inspect_design",
    { title: "Inspect design", description: "A design's size, source, layer counts, roles, text content, images, fonts and import notes.", inputSchema: { designId: id("Design", "dsn") }, annotations: readOnly },
    async (a) => {
      const res = await call("GET", `/designs/${a.designId}`);
      if (res.status >= 400) return res;
      const d = (res.body as { data: Record<string, unknown> }).data;
      return { status: 200, body: { data: { id: d.id, name: d.name, projectId: d.projectId, width: d.width, height: d.height, source: d.source, summary: d.summary, importReport: d.importReport } } };
    },
  );
  tool(
    "list_design_layers",
    {
      title: "List design layers",
      description: "A design's layers with absolute positions, sizes, roles and text, optionally filtered.",
      inputSchema: { designId: id("Design", "dsn"), type: z.enum(["text", "image", "shape", "group"]).optional(), role: z.enum(SEMANTIC_ROLES).optional(), name: z.string().optional() },
      annotations: readOnly,
    },
    ({ designId, ...filter }) => {
      const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v !== undefined) as [string, string][]).toString();
      return call("GET", `/designs/${designId}/layers${q ? `?${q}` : ""}`);
    },
  );

  // ---- jobs
  tool("get_job_status", { title: "Get job status", description: "A background job's status, progress, output or error.", inputSchema: { jobId: id("Job", "job") }, annotations: readOnly }, (a) => call("GET", `/jobs/${a.jobId}`));
  tool("cancel_job", { title: "Cancel job", description: "Cancels a queued or running job.", inputSchema: { jobId: id("Job", "job") } }, (a) => call("POST", `/jobs/${a.jobId}/cancel`));

  return server;
}
