/**
 * OpenViveksha runtime entry point.
 *
 * Wires the pieces together: Store (SQLite) + NodeRegistry (node modules) +
 * GraphExecutor (laws §1–§14). The HTTP server and local MCP server attach in
 * their own modules; `createRuntime()` is the single composition root.
 */

import { Store } from "./store.js";
import { NodeRegistry } from "./registry.js";
import { GraphExecutor } from "./executor.js";
import { McpHub } from "./mcp/hub.js";
import { registerBuiltins } from "./nodes/index.js";
import type { CanvasApi, CanvasEdge, CanvasNode } from "./types.js";

export { Store } from "./store.js";
export { NodeRegistry } from "./registry.js";
export { GraphExecutor } from "./executor.js";
export { McpHub } from "./mcp/hub.js";
export type { RunResult, RunRequest } from "./executor.js";
export type { NodeTypeInfo } from "./registry.js";

export interface Runtime {
  store: Store;
  registry: NodeRegistry;
  executor: GraphExecutor;
  mcpHub: McpHub;
}

export function createRuntime(dbPath: string): Runtime {
  const store = new Store(dbPath);
  const registry = new NodeRegistry();
  const mcpHub = new McpHub();

  const canvasApi = {
    getNode(nodeId: string): CanvasNode | null {
      return store.getNode(nodeId) ?? null;
    },
    getNeighbors(nodeId: string): { id: string; type: string; edgeId: string; port?: string }[] {
      const node = store.getNode(nodeId);
      if (!node) return [];
      return store
        .listEdges(node.canvasId)
        .filter((e) => e.sourceId === nodeId || e.targetId === nodeId)
        .map((e: CanvasEdge) => {
          const neighborId = e.sourceId === nodeId ? e.targetId : e.sourceId;
          const neighbor = store.getNode(neighborId);
          return {
            id: neighborId,
            type: neighbor?.type ?? "unknown",
            edgeId: e.id,
            port: e.sourceId === nodeId ? e.sourcePort : e.targetPort,
          };
        });
    },
    getEdges(canvasId: string): CanvasEdge[] {
      return store.listEdges(canvasId);
    },
  };

  const executor = new GraphExecutor(
    registry,
    canvasApi,
    (canvasId: string) => store.listNodes(canvasId),
    (canvasId: string) => store.listEdges(canvasId),
    { call: (toolName: string, args?: unknown) => mcpHub.callTool(toolName, args) },
  );

  registerBuiltins(registry, store, mcpHub);

  return { store, registry, executor, mcpHub };
}