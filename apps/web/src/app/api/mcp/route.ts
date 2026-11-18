import { injectCaller } from "@adengine/api/mcp";
import { createMcpServer } from "@adengine/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getEngine } from "../../../server/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The MCP endpoint for external agents: https://<site>/api/mcp
 * Stateless Streamable HTTP with JSON responses, so it runs on serverless hosts.
 * Tools call the engine API in-process with the caller's Authorization header.
 */
export async function POST(req: Request): Promise<Response> {
  let app: Awaited<ReturnType<typeof getEngine>>;
  try {
    app = await getEngine();
  } catch (err) {
    console.error("[mcp] engine failed to start:", err);
    return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "The server is not configured correctly." }, id: null }, { status: 500 });
  }
  const server = createMcpServer(injectCaller(app, req.headers.get("authorization") ?? undefined));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void transport.close();
    void server.close();
  }
}

const notAllowed = () =>
  Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Send JSON-RPC requests with POST." }, id: null }, { status: 405, headers: { allow: "POST" } });
export { notAllowed as GET, notAllowed as DELETE };
