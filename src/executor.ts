/**
 * GraphExecutor — laws.md §1–§14.
 *
 * Fixed-point execution of a node graph. Wires are undirected (§1); only
 * incoming edges make a node ready (§2); optional inputs wait for a pending
 * source unless the port is named `reply` (§8 — the anti-race rule, mirrored
 * from production behavior); the run returns the first resolved `reply` (§10).
 */

import type {
  CanvasApi,
  CanvasEdge,
  CanvasNode,
  ExecutionContext,
  ModuleLogger,
  NodeModule,
  PortValues,
  ToolsApi,
  Trace,
  TraceContext,
  TraceObservation,
} from "./types.js";
import type { NodeRegistry } from "./registry.js";

const MAX_STRING = 2000;
const MAX_ITEMS = 50;

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "...[truncated]" : value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) {
      return [...value.slice(0, MAX_ITEMS).map(sanitizeValue), `...+${value.length - MAX_ITEMS} more`];
    }
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return value;
}

class TraceCollector {
  private current: TraceObservation | null = null;

  constructor(private trace: Trace) {}

  begin(nodeId: string, nodeType: string, input: PortValues): void {
    this.current = {
      nodeId,
      nodeType,
      input: sanitizeValue(input) as PortValues,
      output: {},
      durationMs: 0,
      timestamp: new Date().toISOString(),
    };
    this.trace.observations.push(this.current);
  }

  end(output: PortValues, durationMs: number, error?: string): void {
    if (!this.current) return;
    this.current.output = sanitizeValue(output) as PortValues;
    this.current.durationMs = Math.round(durationMs * 100) / 100;
    if (error) this.current.error = error;
    this.current = null;
  }

  get context(): TraceContext {
    const self = this;
    return {
      setTokens(tokensIn: number, tokensOut: number) {
        if (self.current) {
          self.current.tokensIn = tokensIn;
          self.current.tokensOut = tokensOut;
        }
      },
      addMeta(key: string, value: unknown) {
        if (self.current) {
          self.current.meta = { ...(self.current.meta ?? {}), [key]: value };
        }
      },
    };
  }
}

export interface RunResult {
  reply: string;
  warnings?: string[];
  error?: string;
  traceId: string;
}

export interface RunRequest {
  canvasId: string;
  startNodeId: string;
  message: string;
  sessionId: string;
}

export class GraphExecutor {
  private cache = new Map<string, PortValues>();
  private traces = new Map<string, Trace>();
  private invalidateHooks: ((nodeId: string) => void)[] = [];

  constructor(
    private registry: NodeRegistry,
    private canvasApi: CanvasApi,
    private listNodes: (canvasId: string) => CanvasNode[],
    private listEdges: (canvasId: string) => CanvasEdge[],
    private toolsApi?: ToolsApi,
  ) {}

  onInvalidate(hook: (nodeId: string) => void): void {
    this.invalidateHooks.push(hook);
  }

  invalidate(nodeId: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(nodeId + ":")) this.cache.delete(key);
    }
    for (const hook of this.invalidateHooks) hook(nodeId);
  }

  /** laws §6: reachable from the start node in BOTH directions. */
  reachableNodes(startNodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]): Set<string> {
    const neighbors = new Map<string, string[]>();
    for (const n of nodes) neighbors.set(n.id, []);
    for (const e of edges) {
      neighbors.get(e.sourceId)?.push(e.targetId);
      neighbors.get(e.targetId)?.push(e.sourceId);
    }
    const visited = new Set<string>();
    const stack = [startNodeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const nb of neighbors.get(id) ?? []) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    return visited;
  }

  /**
   * laws §1, §4: inputs come from ALL connected edges (undirected wires).
   * value = neighborOut[sourcePort] → inputs[targetPort]; fan-out → array (§3).
   */
  private buildInputs(
    nodeId: string,
    connectedEdges: CanvasEdge[],
    outputs: Map<string, PortValues>,
  ): PortValues {
    const inputs: PortValues = {};
    for (const edge of connectedEdges) {
      if (edge.sourceId !== nodeId && edge.targetId !== nodeId) continue;
      const isTarget = edge.targetId === nodeId;
      const neighborId = isTarget ? edge.sourceId : edge.targetId;
      const neighborOut = outputs.get(neighborId);
      if (!neighborOut) continue;

      const sourcePort =
        edge.sourcePort ?? Object.keys(neighborOut)[0] ?? (isTarget ? edge.targetPort : undefined);
      const targetPort = isTarget
        ? (edge.targetPort ?? sourcePort)
        : (edge.targetPort ?? sourcePort);

      const value = sourcePort ? neighborOut[sourcePort] : undefined;
      if (targetPort && value !== undefined) {
        if (inputs[targetPort] === undefined) {
          inputs[targetPort] = value;
        } else if (Array.isArray(inputs[targetPort])) {
          (inputs[targetPort] as unknown[]).push(value);
        } else {
          inputs[targetPort] = [inputs[targetPort], value];
        }
      }
    }
    return inputs;
  }

  /** laws §7–§8: readiness. Only incoming edges block; optional pending-source waits except `reply`. */
  private isReady(
    nodeId: string,
    mod: NodeModule,
    incomingEdges: CanvasEdge[],
    outputs: Map<string, PortValues>,
    remaining: Set<string>,
  ): boolean {
    for (const edge of incomingEdges) {
      const targetPort = mod.ports.inputs.find((p) => p.name === (edge.targetPort ?? ""));
      const isRequired = targetPort?.required ?? true;
      if (!outputs.has(edge.sourceId)) {
        if (isRequired) return false;
        // §8: optional input whose source is still pending must block too —
        // otherwise a node runs before its tools source executes.
        // Exception: `reply` back-edges close cycles; waiting on them would
        // deadlock (e.g. chat → role → … → reply → chat).
        if (remaining.has(edge.sourceId) && targetPort?.name !== "reply") {
          return false;
        }
      }
    }
    return true;
  }

  async run(req: RunRequest): Promise<RunResult> {
    return this.executeGraph(req);
  }

  private async executeGraph(req: RunRequest): Promise<RunResult> {
    const { canvasId, startNodeId, message, sessionId } = req;
    this.cache.clear(); // laws §14: a run starts from a clean execution cache

    const graphStart = performance.now();
    const trace: Trace = {
      traceId: "trc_" + crypto.randomUUID(),
      sessionId,
      canvasId,
      startNodeId,
      message,
      reply: "",
      totalDurationMs: 0,
      observations: [],
      createdAt: new Date().toISOString(),
    };
    const collector = new TraceCollector(trace);

    const allNodes = this.listNodes(canvasId);
    const allEdges = this.listEdges(canvasId);
    const reachable = this.reachableNodes(startNodeId, allNodes, allEdges);
    const nodes = allNodes.filter((n) => reachable.has(n.id));
    const edges = allEdges.filter((e) => reachable.has(e.sourceId) && reachable.has(e.targetId));

    const outputs = new Map<string, PortValues>();
    const errors: string[] = [];

    // §5 seed: the start node outputs { message } without executing.
    outputs.set(startNodeId, { message });

    const remaining = new Set<string>(nodes.filter((n) => n.id !== startNodeId).map((n) => n.id));

    let progress = true;
    let iterations = 0;
    const maxIterations = nodes.length + 5; // §9: never loop forever

    while (remaining.size > 0 && progress && iterations < maxIterations) {
      progress = false;
      iterations++;

      for (const nodeId of [...remaining]) {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) {
          remaining.delete(nodeId);
          progress = true;
          continue;
        }
        const mod = this.registry.getByType(node.type);
        if (!mod) {
          remaining.delete(nodeId);
          progress = true;
          continue;
        }

        const incomingEdges = edges.filter((e) => e.targetId === nodeId);
        const allEdges = edges.filter((e) => e.sourceId === nodeId || e.targetId === nodeId);

        if (!this.isReady(nodeId, mod, incomingEdges, outputs, remaining)) continue;

        const inputs = this.buildInputs(nodeId, allEdges, outputs);

        const sig = nodeId + ":" + this.inputSignature(inputs);
        if (this.cache.has(sig)) {
          outputs.set(nodeId, this.cache.get(sig)!);
          remaining.delete(nodeId);
          progress = true;
          continue;
        }

        const ctx = {
          nodeId,
          canvasId,
          sessionId,
          inputs,
          data: node.data,
          logger: console,
          cache: {
            get: (nid: string, s: string) => this.cache.get(nid + ":" + s) ?? null,
            set: (nid: string, s: string, v: PortValues) => this.cache.set(nid + ":" + s, v),
            invalidate: (nid: string) => this.invalidate(nid),
          },
          canvasApi: this.canvasApi,
          httpApi: {
            get: async (p: string) => (await fetch(p)).json(),
            post: async (p: string, body: unknown) =>
              (
                await fetch(p, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body ?? {}),
                })
              ).json(),
          },
          trace: collector.context,
          toolsApi: this.toolsApi,
        };

        collector.begin(nodeId, node.type, inputs);
        const t0 = performance.now();
        try {
          const result = await mod.execute(ctx);
          this.cache.set(sig, result);
          outputs.set(nodeId, result);
          collector.end(result, performance.now() - t0);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${node.type} (${nodeId.slice(0, 8)}): ${msg}`);
          collector.end({}, performance.now() - t0, msg);
        }

        // A node with optional inputs still awaiting data stays for later waves.
        const hasPendingOptional = incomingEdges.some((e) => {
          const tp = mod.ports.inputs.find((p) => p.name === (e.targetPort ?? ""));
          return !tp?.required && !outputs.has(e.sourceId);
        });
        if (!hasPendingOptional) {
          remaining.delete(nodeId);
        }
        progress = true;
      }
    }

    // §10: first resolved reply wins; failures ride along as warnings.
    let result: PortValues | null = null;
    for (const [, out] of outputs) {
      if (out?.reply != null) {
        if (errors.length > 0) out.warnings = errors;
        result = out;
        break;
      }
    }
    if (result === null) {
      if (errors.length > 0) {
        result = { reply: "", error: errors.join("; ") };
      } else {
        result = { reply: "", error: "Graph produced no reply — check node connections" };
      }
    }

    trace.reply = typeof result.reply === "string" ? result.reply : JSON.stringify(result.reply ?? "");
    trace.totalDurationMs = Math.round((performance.now() - graphStart) * 100) / 100;
    this.traces.set(trace.traceId, trace);

    return {
      reply: trace.reply,
      warnings: result.warnings as string[] | undefined,
      error: result.error as string | undefined,
      traceId: trace.traceId,
    };
  }

  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  listTraces(limit?: number): Trace[] {
    const list = [...this.traces.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return limit !== undefined ? list.slice(0, limit) : list;
  }

  private inputSignature(inputs: PortValues): string {
    return JSON.stringify(inputs);
  }
}