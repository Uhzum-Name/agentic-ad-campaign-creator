import { getEngine } from "../../../server/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Hands /api/<path> to the embedded engine API as /v1/<path>. */
async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  let app: Awaited<ReturnType<typeof getEngine>>;
  try {
    app = await getEngine();
  } catch (err) {
    console.error("[api] engine failed to start:", err);
    return Response.json({ error: { code: "internal_error", message: "The server is not configured correctly. Check DATABASE_URL." } }, { status: 500 });
  }
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
  return new Response(res.statusCode === 204 ? null : res.body, {
    status: res.statusCode,
    headers: { "content-type": String(res.headers["content-type"] ?? "application/json"), "cache-control": "no-store" },
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
