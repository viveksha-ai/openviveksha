/**
 * Local MCP server — the programming surface for AI clients (spec/mcp-tools.md).
 * stdio transport for CLI clients (OpenCode, Claude Code); the same tools are
 * reachable over HTTP at /mcp for local hosts. No auth — trust boundary is
 * the machine.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat, AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Runtime } from "../index.js";
import { CanvasService } from "../services.js";
import type { IncomingMessage, ServerResponse } from "node:http";

export function createMcpServer(rt: Runtime): McpServer {
  const svc = new CanvasService(rt);
  const server = new McpServer({ name: "openviveksha", version: "0.1.2" });
  const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

  type ToolConfig<InputArgs> = {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;
    outputSchema?: Record<string, AnySchema> | AnySchema;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
  };

  const registerLoggedTool = <
    OutputArgs extends ZodRawShapeCompat | AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  >(
    name: string,
    config: ToolConfig<InputArgs>,
    handler: ToolCallback<InputArgs>,
  ) =>
    server.registerTool(
      name,
      config as Parameters<typeof server.registerTool>[1],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (...rest: Parameters<typeof handler>) => {
        const args = config.inputSchema !== undefined ? (rest[0] as unknown) : undefined;
        if (rt.verbose) {
          const argSummary
            = args
              && typeof args === "object"
              ? Object.entries(args).map(([k, v]) => k + "=" + String(typeof v === "string" ? v.slice(0, 40) : JSON.stringify(v)?.slice(0, 40) ?? "")).join(" ")
              : "";
          console.error("→ " + name + (argSummary ? " (" + argSummary + ")" : ""));
        }
        try {
          const res = await (handler as (...a: unknown[]) => Promise<unknown>)(...rest);
          if (rt.verbose) console.error("← " + name + " ok");
          return res;
        } catch (e) {
          if (rt.verbose) console.error("← " + name + " ERR: " + String((e as Error).message));
          throw e;
        }
      }) as Parameters<typeof server.registerTool>[2],
    );

  registerLoggedTool(
    "list_nodes",
    { title: "List node types", description: "List every registered node type with its config schema and ports. Call this first; never guess node shapes.", inputSchema: {} },
    async () => json({ ok: true, types: svc.listTypes() }),
  );

  registerLoggedTool(
    "get_node_schema",
    {
      title: "Get node schema",
      description: "One node type's full contract (dataSchema + ports). Unknown type → error listing available types.",
      inputSchema: { type: z.string().describe("node type, e.g. role") },
    },
    async ({ type }) => json({ ok: true, ...svc.getNodeType(type) }),
  );

  registerLoggedTool(
    "create_canvas",
    {
      title: "Create canvas",
      description: "Create an empty canvas. Returns its id — pass it to create_node.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => json({ ok: true, canvas: svc.createCanvas(name) }),
  );

  registerLoggedTool(
    "create_node",
    {
      title: "Create node",
      description: "Create a node on a canvas. Returns the EFFECTIVE data (defaults applied) — treat it as the source of truth. Secret values may be ${ENV_NAME}.",
      inputSchema: {
        canvasId: z.string(),
        type: z.string(),
        data: z.record(z.string(), z.unknown()).default({}),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      },
    },
    async ({ canvasId, type, data, position }) => {
      if (!svc.getCanvas(canvasId)) return json({ ok: false, error: `canvas ${canvasId} not found` });
      const node = svc.createNode(canvasId, type, data, position);
      return json({ ok: true, node });
    },
  );

  registerLoggedTool(
    "update_node",
    {
      title: "Update node",
      description: "Full replacement of node data (validated, defaults applied). Response echoes the effective data.",
      inputSchema: {
        canvasId: z.string(),
        nodeId: z.string(),
        data: z.record(z.string(), z.unknown()),
      },
    },
    async ({ canvasId, nodeId, data }) => json({ ok: true, node: svc.updateNode(canvasId, nodeId, data) }),
  );

  registerLoggedTool(
    "delete_node",
    {
      title: "Delete node",
      description: "Remove a node and its edges.",
      inputSchema: { canvasId: z.string(), nodeId: z.string() },
    },
    async ({ canvasId, nodeId }) => {
      svc.deleteNode(canvasId, nodeId);
      return json({ ok: true });
    },
  );

  registerLoggedTool(
    "create_edge",
    {
      title: "Create edge (wire)",
      description: "Connect two nodes. sourcePort and targetPort are REQUIRED; unknown names and type mismatches are rejected. Self-edges are rejected.",
      inputSchema: {
        canvasId: z.string(),
        sourceId: z.string(),
        sourcePort: z.string(),
        targetId: z.string(),
        targetPort: z.string(),
      },
    },
    async (a) => json({ ok: true, edge: svc.createEdge(a.canvasId, a.sourceId, a.targetId, a.sourcePort, a.targetPort) }),
  );

  registerLoggedTool(
    "delete_edge",
    {
      title: "Delete edge",
      description: "Remove a wire.",
      inputSchema: { canvasId: z.string(), edgeId: z.string() },
    },
    async ({ canvasId, edgeId }) => {
      svc.deleteEdge(canvasId, edgeId);
      return json({ ok: true });
    },
  );

  registerLoggedTool(
    "validate_canvas",
    {
      title: "Validate canvas",
      description: "Static checker: dangling edges, unknown ports, type mismatches, unwired required inputs, cycle report, heuristics (maxTokens, inactive nodes). Call before run_canvas.",
      inputSchema: { canvasId: z.string() },
    },
    async ({ canvasId }) => json({ ok: true, ...svc.validateCanvas(canvasId) }),
  );

  registerLoggedTool(
    "run_canvas",
    {
      title: "Run canvas",
      description: "Execute the graph. startNodeId optional when exactly one io-category node exists. Result: { reply, warnings, error?, traceId } (laws §10).",
      inputSchema: {
        canvasId: z.string(),
        message: z.string(),
        startNodeId: z.string().optional(),
        sessionId: z.string().optional(),
      },
    },
    async ({ canvasId, message, startNodeId, sessionId }) =>
      json({ ok: true, ...(await svc.run(canvasId, startNodeId, message, sessionId ?? "sess_" + crypto.randomUUID())) }),
  );

  registerLoggedTool(
    "test_agent",
    {
      title: "Test agent (multi-turn)",
      description: "Convenience multi-turn check: keeps one session across messages, returns every turn. Use this to verify the agent you just built.",
      inputSchema: { canvasId: z.string(), messages: z.array(z.string()).min(1) },
    },
    async ({ canvasId, messages }) => json({ ok: true, ...(await svc.testAgent(canvasId, messages)) }),
  );

  return server;
}

// Stateless streamable HTTP: one request → one response (v0.1, no sessions).
// Mounted by the main HTTP server (src/server.ts) at /mcp — behind the same
// Origin guard as /api.
export async function handleMcpHttp(rt: Runtime, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const mcp = createMcpServer(rt);
  await mcp.connect(transport);
  try {
    await transport.handleRequest(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(500).end();
  } finally {
    void transport.close();
    void mcp.close();
  }
}

// stdio entry used by AI clients that spawn the process.
export async function serveMcpStdio(rt: Runtime): Promise<void> {
  const mcp = createMcpServer(rt);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}