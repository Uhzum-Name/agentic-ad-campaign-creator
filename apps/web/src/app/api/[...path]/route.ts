export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Hands /api/<path> to the embedded engine API as /v1/<path>. */
async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  try {
    return await forward(req, path);
  } catch (err) {
    // Includes failures to load or start the engine. The reason is returned so
    // a broken deployment explains itself; tighten this before a public launch.
    console.error("[api] request failed before reaching the engine:", err);
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return Response.json({ error: { code: "internal_error", message: `The server could not handle the request. ${reason}`.slice(0, 600) } }, { status: 500 });
  }
}

async function forward(req: Request, path: string[]): Promise<Response> {
  // Loaded on demand so a module that fails to load is reported, not a bare 500.
  const { getEngine } = await import("../../../server/engine");
  const app = await getEngine();
  const body = req.method === "GET" || req.method === "DELETE" ? "" : await req.text();
  const headers: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  if (auth) headers.authorization = auth;
  if (body) headers["content-type"] = req.headers.get("content-type") ?? "application/json";

  const res = await app.inject({
    method: req.method as Method,
    url: `/v1/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`,
    headers,
    ...(body ? { payload: body } : {}),
  });
  // rawPayload keeps binary responses (stored images) intact.
  return new Response(res.statusCode === 204 ? null : new Uint8Array(res.rawPayload), {
    status: res.statusCode,
    headers: {
      "content-type": String(res.headers["content-type"] ?? "application/json"),
      "cache-control": String(res.headers["cache-control"] ?? "no-store"),
      ...(res.headers["content-security-policy"] ? { "content-security-policy": String(res.headers["content-security-policy"]) } : {}),
      "x-content-type-options": "nosniff",
    },
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
