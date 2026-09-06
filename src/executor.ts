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

  constructor(private trace: Trace, private getSecrets: (nodeType: string) => string[]) {}

  /**
   * laws §13 (critique #7): secret fields and PROMPT payloads never enter
   * traces — secrets become [redacted], PROMPT objects become counts/lengths.
   */
  private redact(nodeType: string, values: PortValues): PortValues {
    const secrets = this.getSecrets(nodeType);
    const out: PortValues = {};
    for (const [k, v] of Object.entries(values)) {
      if (secrets.includes(k)) {
        out[k] = "[redacted]";
        continue;
      }
      if (k === "prompt" && v && typeof v === "object") {
        const p = v as { system?: unknown; messages?: unknown[]; tools?: unknown[] };
        out[k] = {
          system: typeof p.system === "string" ? `string(${p.system.length})` : undefined,
          messages: `count(${Array.isArray(p.messages) ? p.messages.length : 0})`,
          tools: Array.isArray(p.tools) ? `count(${p.tools.length})` : undefined,
        };
        continue;
      }
      out[k] = sanitizeValue(v);
    }
    return out;
  }

  begin(nodeId: string, nodeType: string, input: PortValues): void {
    this.current = {
      nodeId,
      nodeType,
      input: this.redact(nodeType, input),
      output: {},
      durationMs: 0,
      timestamp: new Date().toISOString(),
    };
    this.trace.observations.push(this.current);
  }

  end(output: PortValues, durationMs: number, error?: string): void {
    if (!this.current) return;
    this.current.output = this.redact(this.current.nodeType, output);
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
  private traces = new Map<string, Trace>();

  constructor(
    private registry: NodeRegistry,
    private canvasApi: CanvasApi,
    private listNodes: (canvasId: string) => CanvasNode[],
    private listEdges: (canvasId: string) => CanvasEdge[],
    private toolsApi?: ToolsApi,
  ) {}

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

  /** laws §7–§8 (port-level, critique #3): a required input PORT is satisfied
   * when AT LEAST ONE incoming edge targeting it delivers a value. Optional:
   * wait for a pending source (§8), unless the port is `reply`; a finished
   * source with no value means the input is simply absent (§8, run anyway). */
  private isReady(
    nodeId: string,
    mod: NodeModule,
    incomingEdges: CanvasEdge[],
    outputs: Map<string, PortValues>,
    remaining: Set<string>,
  ): boolean {
    const byPort = new Map<string, { required: boolean; satisfied: boolean; pending: boolean; isReply: boolean }>();
    for (const edge of incomingEdges) {
      const neighborOut = outputs.get(edge.sourceId);
      const sourcePort = edge.sourcePort ?? (neighborOut ? Object.keys(neighborOut)[0] : undefined);
      const targetPort = edge.targetPort ?? sourcePort;
      if (!targetPort) continue;
      const def = mod.ports.inputs.find((p) => p.name === targetPort);
      const state = byPort.get(targetPort) ?? {
        required: def?.required ?? true,
        satisfied: false,
        pending: false,
        isReply: targetPort === "reply",
      };
      const value = neighborOut && sourcePort ? neighborOut[sourcePort] : undefined;
      if (value !== undefined) state.satisfied = true;
      if (!outputs.has(edge.sourceId)) state.pending = true;
      byPort.set(targetPort, state);
    }
    for (const [, state] of byPort) {
      if (state.satisfied) continue;
      if (state.required && !state.pending) return false; // required, never satisfied
      if (state.pending && !state.isReply) return false; // §8: wait for a pending source (required AND optional)
    }
    return true;
  }

  async run(req: RunRequest): Promise<RunResult> {
    return this.executeGraph(req);
  }

  private async executeGraph(req: RunRequest): Promise<RunResult> {
    const { canvasId, startNodeId, message, sessionId } = req;
    // laws v0.1.2: no cross-run cache (§14 cut per critique #8); stability is
    // tracked per run via executedSig.

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
    const collector = new TraceCollector(trace, (t) => this.registry.getByType(t)?.secretFields ?? []);

    const allNodes = this.listNodes(canvasId);
    const allEdges = this.listEdges(canvasId);
    const reachable = this.reachableNodes(startNodeId, allNodes, allEdges);
    const nodes = allNodes.filter((n) => reachable.has(n.id));
    const edges = allEdges.filter((e) => reachable.has(e.sourceId) && reachable.has(e.targetId));

    const outputs = new Map<string, PortValues>();
    const errors: string[] = [];

    // §5 seed: the start node outputs { message } without executing.
    outputs.set(startNodeId, { message });

    const startReplyEdges = edges.filter(
      (e) => e.targetId === startNodeId && (e.targetPort ?? e.sourcePort) === "reply",
    );
    let startReply: unknown = null;

    // True fixed point (§9): nodes stay in the worklist and re-execute when
    // their inputs change. The tool loop emerges from this: tools re-prompts →
    // llm re-runs → final reply → both sides stabilize → done.
    const worklist = new Set<string>(
      nodes.filter((n) => n.id !== startNodeId).map((n) => n.id),
    );
    const executedSig = new Map<string, string>();

    let progress = true;
    let iterations = 0;
    const maxIterations = Math.max(nodes.length * 4 + 16, 64); // §9: never loop forever

    while (worklist.size > 0 && progress && iterations < maxIterations) {
      progress = false;
      iterations++;

      for (const nodeId of [...worklist]) {
        const node = nodes.find((n) => n.id === nodeId);
        const mod = node ? this.registry.getByType(node.type) : undefined;
        if (!node || !mod) {
          worklist.delete(nodeId); // nothing to execute — not a failure
          progress = true;
          continue;
        }

        const incomingEdges = edges.filter((e) => e.targetId === nodeId);
        const allEdges = edges.filter((e) => e.sourceId === nodeId || e.targetId === nodeId);

        if (!this.isReady(nodeId, mod, incomingEdges, outputs, worklist)) continue;

        const inputs = this.buildInputs(nodeId, allEdges, outputs);
        const sig = this.inputSignature(inputs);
        if (executedSig.get(nodeId) === sig && outputs.has(nodeId)) continue; // stable

        const ctx = {
          nodeId,
          canvasId,
          sessionId,
          inputs,
          data: node.data,
          logger: console,
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
          outputs.set(nodeId, result);
          executedSig.set(nodeId, sig);
          collector.end(result, performance.now() - t0);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${node.type} (${nodeId.slice(0, 8)}): ${msg}`);
          // A failed node is finished with no output (critique #13): consumers
          // of its optional ports run without the value; required ports end
          // the run with the collected error.
          outputs.set(nodeId, {});
          executedSig.set(nodeId, sig);
          collector.end({}, performance.now() - t0, msg);
        }
        progress = true;
      }

      // §10/termination (critique #1/#2): the run ends when a reply value is
      // delivered to the start node's `reply` input. The start node never
      // re-executes and never republishes a received reply.
      for (const e of startReplyEdges) {
        const out = outputs.get(e.sourceId);
        const v = out ? out[e.sourcePort ?? "reply"] : undefined;
        if (v != null) {
          startReply = v;
          break;
        }
      }
      if (startReply != null) break;
    }
    if (iterations >= maxIterations) {
      errors.push("executor: iteration cap reached (§9) — the graph did not stabilize");
    }

    // §10 (critique #2): the reply delivered to the start node's reply input
    // is the run result. Fallback: first non-null reply output.
    let result: PortValues | null = null;
    if (startReply != null) {
      result = { reply: startReply };
      if (errors.length > 0) result.warnings = errors;
    } else {
      for (const [, out] of outputs) {
        if (out?.reply != null) {
          if (errors.length > 0) out.warnings = errors;
          result = out;
          break;
        }
      }
    }
    if (result === null) {
      // §7: name the required inputs that never received a value.
      for (const n of nodes) {
        if (outputs.has(n.id)) continue; // ran (or failed) — its error is already collected
        const mod = this.registry.getByType(n.type);
        if (!mod) continue;
        for (const port of mod.ports.inputs) {
          if (!port.required) continue;
          const delivered = edges.some((e) => {
            if (e.targetId !== n.id || (e.targetPort ?? e.sourcePort) !== port.name) return false;
            const o = outputs.get(e.sourceId);
            const sp = e.sourcePort ?? (o ? Object.keys(o)[0] : undefined);
            return o !== undefined && sp !== undefined && o[sp] !== undefined;
          });
          if (!delivered) {
            errors.push(`laws §7: ${n.type} (${n.id.slice(0, 8)}): required input "${port.name}" never received a value`);
          }
        }
      }
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