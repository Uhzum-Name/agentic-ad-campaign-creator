import { type ApiCaller, createMcpServer } from "@adengine/mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";

/** Calls this app's own /v1 API in-process, carrying the caller's credentials. */
export function injectCaller(app: FastifyInstance, authorization?: string): ApiCaller {
  return async (method, path, body) => {
    const res = await app.inject({
      method,
      url: `/v1${path}`,
      headers: authorization ? { authorization } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
  };
}

const methodNotAllowed = { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This MCP server is stateless: send JSON-RPC requests with POST." }, id: null };

/**
 * MCP over Streamable HTTP at POST /mcp, stateless: each request gets a fresh
 * server, so it works the same on a long-running server and on serverless hosts.
 * Authentication is the REST API's: the caller's Authorization header is passed
 * through to every /v1 call the tools make.
 */
export function registerMcpRoute(app: FastifyInstance): void {
  app.post("/mcp", async (req, reply) => {
    const server = createMcpServer(injectCaller(app, req.headers.authorization));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  app.get("/mcp", async (_req, reply) => reply.status(405).send(methodNotAllowed));
  app.delete("/mcp", async (_req, reply) => reply.status(405).send(methodNotAllowed));
}
