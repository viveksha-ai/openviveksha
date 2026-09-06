/**
 * HTTP API — local, single-user, no auth by design (trust boundary = the
 * machine). Binds 127.0.0.1 unless --host is passed explicitly (critique #11).
 * No CORS: cross-origin browser requests are rejected (Origin check).
 *
 * Routes:
 *   POST /api/canvas                         {name} → canvas
 *   GET  /api/canvas                         → canvases
 *   GET  /api/canvas/:id                     → canvas + nodes (secrets stripped)
 *   DELETE /api/canvas/:id
 *   POST /api/canvas/:id/node                {type, data, position?}
 *   PUT  /api/node/:nodeId                   {data}
 *   DELETE /api/node/:nodeId
 *   POST /api/canvas/:id/edge                {sourceId, sourcePort, targetId, targetPort}
 *   DELETE /api/edge/:edgeId
 *   GET  /api/canvas/:id/validate            → {valid, errors, warnings}
 *   POST /api/canvas/:id/run                 {message, sessionId?, startNodeId?}
 *   POST /api/canvas/:id/test_agent          {messages: string[]}
 *   GET  /api/trace/:traceId
 *   POST /api/ingress/webhook/:nodeId        {message} + X-Ingress-Secret
 */

import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { Runtime } from "./index.js";
import { CanvasService } from "./services.js";

interface Ctx {
  params: Record<string, string>;
  body: unknown;
  originOk: boolean;
  secret: string | undefined;
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

export interface ServerOptions {
  port: number;
  host: string; // 127.0.0.1 by default — binding 0.0.0.0 must be explicit
}

export function createHttpServer(rt: Runtime, opts: ServerOptions): Server {
  const svc = new CanvasService(rt);
  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler; checkOrigin: boolean }[] = [];
  const route = (method: string, path: string, handler: Handler, checkOrigin = true) => {
    const keys: string[] = [];
    const pattern = new RegExp(
      "^" +
        path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
          keys.push(k);
          return "([^/]+)";
        }) +
        "$",
    );
    routes.push({ method, pattern, keys, handler, checkOrigin });
  };

  route("POST", "/api/canvas", (c) => {
    const b = c.body as { name?: string };
    if (typeof b?.name !== "string" || !b.name) throw new Error("body.name (string) is required");
    return svc.createCanvas(b.name);
  });
  route("GET", "/api/canvas", () => svc.listCanvases());
  route("GET", "/api/canvas/:id", (c) => {
    const canvas = svc.getCanvas(c.params.id!);
    if (!canvas) throw new Error("canvas not found");
    return {
      ...canvas,
      nodes: rt.store.listNodes(canvas.id).map((n) => svc.readNode(n.id)),
      edges: rt.store.listEdges(canvas.id),
    };
  });
  route("DELETE", "/api/canvas/:id", (c) => svc.deleteCanvas(c.params.id!));
  route("POST", "/api/canvas/:id/node", (c) => {
    const b = c.body as { type?: string; data?: Record<string, unknown>; position?: { x: number; y: number } };
    if (typeof b?.type !== "string") throw new Error("body.type (string) is required");
    return svc.createNode(c.params.id!, b.type, b.data ?? {}, b.position);
  });
  route("PUT", "/api/node/:nodeId", (c) => {
    const b = c.body as { data?: Record<string, unknown> };
    const node = rt.store.getNode(c.params.nodeId!);
    if (!node) throw new Error("node not found");
    return svc.updateNode(node.canvasId, c.params.nodeId!, b?.data ?? {});
  });
  route("DELETE", "/api/node/:nodeId", (c) => {
    const node = rt.store.getNode(c.params.nodeId!);
    if (!node) throw new Error("node not found");
    svc.deleteNode(node.canvasId, c.params.nodeId!);
    return { ok: true };
  });
  route("POST", "/api/canvas/:id/edge", (c) => {
    const b = c.body as { sourceId?: string; sourcePort?: string; targetId?: string; targetPort?: string };
    return svc.createEdge(c.params.id!, b!.sourceId!, b!.targetId!, b!.sourcePort, b!.targetPort);
  });
  route("DELETE", "/api/edge/:edgeId", (c) => {
    const edge = rt.store.getEdge(c.params.edgeId!);
    if (!edge) throw new Error("edge not found");
    svc.deleteEdge(edge.canvasId, c.params.edgeId!);
    return { ok: true };
  });
  route("GET", "/api/canvas/:id/validate", (c) => svc.validateCanvas(c.params.id!));
  route("POST", "/api/canvas/:id/run", (c) => {
    const b = c.body as { message?: string; sessionId?: string; startNodeId?: string };
    if (typeof b?.message !== "string") throw new Error("body.message (string) is required");
    return svc.run(c.params.id!, b.startNodeId, b.message, b.sessionId ?? "sess_" + crypto.randomUUID());
  });
  route("POST", "/api/canvas/:id/test_agent", (c) => {
    const b = c.body as { messages?: string[] };
    if (!Array.isArray(b?.messages)) throw new Error("body.messages (string[]) is required");
    return svc.testAgent(c.params.id!, b.messages);
  });
  route("GET", "/api/trace/:traceId", (c) => rt.executor.getTrace(c.params.traceId!) ?? { error: "trace not found" });
  route("POST", "/api/ingress/webhook/:nodeId", (c) => {
    const b = (c.body ?? {}) as { message?: unknown };
    return svc.webhookIngress(c.params.nodeId!, b, c.secret);
  }, /* checkOrigin */ false);

  return createServer((req, res) => {
    void handle(rt, svc, routes, req, res).catch((err) => {
      send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  }).listen(opts.port, opts.host);
}

async function handle(
  rt: Runtime,
  svc: CanvasService,
  routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler; checkOrigin: boolean }[],
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = req.method ?? "GET";
  try {
    // Local trust boundary (critique #11): reject cross-origin browser calls
    // for /api (webhook ingress is exempt — callers are servers, no Origin).
    const origin = req.headers.origin;
    if (origin) {
      const host = new URL(origin).host;
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
        return send(res, 403, { ok: false, error: "cross-origin requests are not allowed" });
      }
    }

    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));

      let body: unknown = undefined;
      if (method === "POST" || method === "PUT") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        if (raw) {
          body = JSON.parse(raw);
        }
      }

      const secret = req.headers["x-ingress-secret"] as string | undefined;
      const result = await r.handler({ params, body, originOk: true, secret });
      send(res, 200, { ok: true, ...(result as object) });
      return;
    }
    send(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    send(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}