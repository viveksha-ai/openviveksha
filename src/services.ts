/**
 * CanvasService — the single implementation behind both surfaces (HTTP API
 * and local MCP tools). Pure domain logic; servers are thin wrappers.
 */

import { timingSafeEqual } from "node:crypto";
import type { Runtime } from "./index.js";
import { resolveSecrets, stripSecrets, effectiveData } from "./secrets.js";
import type { CanvasNode, Trace } from "./types.js";
import type { NodeTypeInfo } from "./registry.js";

export interface RunOutcome {
  reply: string;
  warnings: string[];
  error?: string;
  traceId: string;
}

export class CanvasService {
  constructor(private rt: Runtime) {}

  // ─── node type introspection ────────────────────────────────────────────────

  listTypes(): NodeTypeInfo[] {
    return this.rt.registry.listTypes();
  }

  getNodeType(type: string): NodeTypeInfo {
    const info = this.rt.registry.getTypeInfo(type);
    if (!info) {
      throw new Error(`unknown node type "${type}" — available: ${this.typeNames().join(", ")}`);
    }
    return info;
  }

  typeNames(): string[] {
    return this.rt.registry.listTypes().map((t) => t.type);
  }

  // ─── canvas CRUD ────────────────────────────────────────────────────────────

  createCanvas(name: string) {
    return this.rt.store.createCanvas(name);
  }

  listCanvases() {
    return this.rt.store.listCanvases();
  }

  getCanvas(id: string) {
    return this.rt.store.getCanvas(id);
  }

  deleteCanvas(id: string) {
    this.rt.store.deleteCanvas(id);
  }

  createNode(
    canvasId: string,
    type: string,
    data: Record<string, unknown>,
    position?: { x: number; y: number },
  ) {
    const effective = effectiveData(this.rt.registry, type, data);
    const node = this.rt.store.createNode(canvasId, type, effective, position);
    return this.readNode(node.id)!;
  }

  updateNode(canvasId: string, nodeId: string, data: Record<string, unknown>) {
    const node = this.rt.store.getNode(nodeId);
    if (!node || node.canvasId !== canvasId) throw new Error(`node ${nodeId} not found in ${canvasId}`);
    const effective = effectiveData(this.rt.registry, node.type, data);
    this.rt.store.updateNode(nodeId, effective);
    return this.readNode(nodeId)!;
  }

  deleteNode(canvasId: string, nodeId: string) {
    const node = this.rt.store.getNode(nodeId);
    if (!node || node.canvasId !== canvasId) throw new Error(`node ${nodeId} not found in ${canvasId}`);
    for (const e of this.rt.store.listEdges(canvasId)) {
      if (e.sourceId === nodeId || e.targetId === nodeId) this.rt.store.deleteEdge(e.id);
    }
    this.rt.store.deleteNode(nodeId);
  }

  createEdge(
    canvasId: string,
    sourceId: string,
    targetId: string,
    sourcePort?: string,
    targetPort?: string,
  ) {
    if (sourceId === targetId) throw new Error("create_edge: self-edges are not allowed");
    const source = this.rt.store.getNode(sourceId);
    const target = this.rt.store.getNode(targetId);
    if (!source || source.canvasId !== canvasId) throw new Error(`source node ${sourceId} not found`);
    if (!target || target.canvasId !== canvasId) throw new Error(`target node ${targetId} not found`);
    if (!sourcePort || !targetPort) {
      throw new Error(
        "create_edge: sourcePort and targetPort are required (explicit ports only — see spec/mcp-tools.md)",
      );
    }
    const sourceMod = this.rt.registry.getByType(source.type);
    const targetMod = this.rt.registry.getByType(target.type);
    const outPort = sourceMod?.ports.outputs.find((p) => p.name === sourcePort);
    const inPort = targetMod?.ports.inputs.find((p) => p.name === targetPort);
    if (!outPort) {
      throw new Error(
        `create_edge: source ${source.type} has no output port "${sourcePort}" — has: ${sourceMod?.ports.outputs.map((p) => p.name).join(", ")}`,
      );
    }
    if (!inPort) {
      throw new Error(
        `create_edge: target ${target.type} has no input port "${targetPort}" — has: ${targetMod?.ports.inputs.map((p) => p.name).join(", ")}`,
      );
    }
    if (outPort.type !== "ANY" && inPort.type !== "ANY" && outPort.type !== inPort.type) {
      throw new Error(
        `create_edge: port type mismatch — ${source.type}.${sourcePort} is ${outPort.type}, ${target.type}.${targetPort} is ${inPort.type}`,
      );
    }
    return this.rt.store.createEdge(canvasId, sourceId, targetId, sourcePort, targetPort);
  }

  deleteEdge(canvasId: string, edgeId: string) {
    const edge = this.rt.store.getEdge(edgeId);
    if (!edge || edge.canvasId !== canvasId) throw new Error(`edge ${edgeId} not found`);
    this.rt.store.deleteEdge(edgeId);
  }

  /** Read-back: secrets omitted entirely (laws §11), defaults visible. */
  readNode(nodeId: string): Omit<CanvasNode, "data"> & { data: Record<string, unknown> } | undefined {
    const node = this.rt.store.getNode(nodeId);
    if (!node) return undefined;
    const mod = this.rt.registry.getByType(node.type);
    const webhookUrl =
      node.type === "channel" && node.data["active"] === true
        ? `/api/ingress/webhook/${node.id}`
        : undefined;
    return {
      ...node,
      data: { ...stripSecrets(node.data, mod?.secretFields ?? []), ...(webhookUrl ? { webhookUrl } : {}) },
    };
  }

  // ─── validation (spec/mcp-tools.md) ────────────────────────────────────────

  validateCanvas(canvasId: string): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const nodes = this.rt.store.listNodes(canvasId);
    const edges = this.rt.store.listEdges(canvasId);
    const byId = new Map(nodes.map((n) => [n.id, n]));

    for (const e of edges) {
      if (!byId.has(e.sourceId)) errors.push(`edge ${e.id}: source ${e.sourceId} does not exist`);
      if (!byId.has(e.targetId)) errors.push(`edge ${e.id}: target ${e.targetId} does not exist`);
      const src = byId.get(e.sourceId)!;
      const tgt = byId.get(e.targetId)!;
      if (src && tgt) {
        const sm = this.rt.registry.getByType(src.type);
        const tm = this.rt.registry.getByType(tgt.type);
        const sp = e.sourcePort ?? sm?.ports.outputs[0]?.name;
        const tp = e.targetPort ?? sp;
        if (sm && !sm.ports.outputs.some((p) => p.name === sp)) {
          errors.push(`edge ${e.id}: ${src.type} has no output port "${sp}"`);
        }
        if (tm && !tm.ports.inputs.some((p) => p.name === tp)) {
          errors.push(`edge ${e.id}: ${tgt.type} has no input port "${tp}"`);
        }
        const outDef = sm?.ports.outputs.find((p) => p.name === sp);
        const inDef = tm?.ports.inputs.find((p) => p.name === tp);
        if (outDef && inDef && outDef.type !== "ANY" && inDef.type !== "ANY" && outDef.type !== inDef.type) {
          errors.push(`edge ${e.id}: type mismatch ${outDef.type} → ${inDef.type}`);
        }
      }
    }

    for (const n of nodes) {
      const mod = this.rt.registry.getByType(n.type);
      if (!mod) {
        errors.push(`node ${n.id} (${n.type}): type not registered`);
        continue;
      }
      for (const port of mod.ports.inputs) {
        if (!port.required) continue;
        const wired = edges.some(
          (e) => e.targetId === n.id && (e.targetPort ?? e.sourcePort) === port.name,
        );
        if (!wired) errors.push(`node ${n.id} (${n.type}): required input "${port.name}" has no wired edge`);
      }
      // heuristics (warnings only)
      const fedByTools = edges.some(
        (e) => e.targetId === n.id && byId.get(e.sourceId)?.type === "tools",
      );
      if (
        n.type === "provider-llm" &&
        fedByTools &&
        typeof n.data["maxTokens"] === "number" &&
        (n.data["maxTokens"] as number) < 8192
      ) {
        warnings.push(
          `provider-llm node '${n.id}': maxTokens < 8192 with a tools wire attached — tool arguments may be truncated`,
        );
      }
      if ((n.type === "mcp" || n.type === "channel") && n.data["active"] !== true) {
        warnings.push(`${n.type} node '${n.id}' is active: false — it will not trigger/emit`);
      }
      if (n.type === "chat-history") {
        const replyWired = edges.some(
          (e) => e.sourceId === n.id && (e.sourcePort ?? "") === "reply",
        );
        if (!replyWired) {
          warnings.push(`chat-history node '${n.id}': no reply wire — assistant turns will not be recorded`);
        }
      }
      // cycle report
      const inEdges = edges.filter((e) => e.targetId === n.id);
      for (const e of inEdges) {
        if (this.reaches(edges, n.id, e.sourceId)) {
          warnings.push(`node '${n.id}' participates in a cycle (legal — laws §8/§9 — review intended)`);
          break;
        }
      }
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  private reaches(edges: { sourceId: string; targetId: string }[], from: string, to: string): boolean {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.sourceId)) adj.set(e.sourceId, []);
      adj.get(e.sourceId)!.push(e.targetId);
    }
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const nxt of adj.get(id) ?? []) stack.push(nxt);
    }
    return false;
  }

  // ─── runs ───────────────────────────────────────────────────────────────────

  /** Resolve ${ENV} refs in secret fields before execution (laws §11). */
  private prepareSecrets(canvasId: string): void {
    for (const node of this.rt.store.listNodes(canvasId)) {
      const mod = this.rt.registry.getByType(node.type);
      if (!mod?.secretFields?.length) continue;
      this.rt.store.updateNode(node.id, resolveSecrets(node.data, mod.secretFields));
    }
  }

  resolveStartNodeId(canvasId: string, startNodeId?: string): string {
    if (startNodeId) {
      const node = this.rt.store.getNode(startNodeId);
      if (!node || node.canvasId !== canvasId) {
        throw new Error(`startNodeId ${startNodeId} not found in canvas ${canvasId}`);
      }
      return startNodeId;
    }
    const candidates = this.rt.store
      .listNodes(canvasId)
      .filter((n) => this.rt.registry.getByType(n.type)?.category === "io");
    if (candidates.length === 1) return candidates[0]!.id;
    throw new Error(
      `startNodeId required — io-category nodes: ${candidates.map((c) => c.id).join(", ") || "none"}`,
    );
  }

  async run(
    canvasId: string,
    startNodeId: string | undefined,
    message: string,
    sessionId: string,
  ): Promise<RunOutcome> {
    this.prepareSecrets(canvasId);
    const start = this.resolveStartNodeId(canvasId, startNodeId);
    const res = await this.rt.executor.run({ canvasId, startNodeId: start, message, sessionId });
    if (this.rt.verbose) {
      const t = this.rt.executor.getTrace(res.traceId);
      if (t) this.printRunTrace(t);
    }
    return { reply: res.reply, warnings: res.warnings ?? [], error: res.error, traceId: res.traceId };
  }

  private printRunTrace(t: Trace): void {
    console.error(`▶ run ${t.traceId} canvas ${t.canvasId}`);
    for (const o of t.observations) {
      let line = `✓ ${o.nodeType} ${o.durationMs}ms`;
      if (o.tokensIn !== undefined || o.tokensOut !== undefined) {
        line += ` tok ${o.tokensIn ?? 0}/${o.tokensOut ?? 0}`;
      }
      if (o.error) line += ` ERR ${o.error}`;
      console.error(line);
    }
    console.error(`← reply (${t.reply.length} chars) total ${t.totalDurationMs}ms`);
  }

  async testAgent(canvasId: string, messages: string[]) {
    const start = this.resolveStartNodeId(canvasId, undefined);
    const sessionId = "test_" + crypto.randomUUID();
    const turns: { message: string; reply: string }[] = [];
    const traceIds: string[] = [];
    for (const message of messages) {
      const r = await this.run(canvasId, start, message, sessionId);
      turns.push({ message, reply: r.reply, ...(r.error ? { error: r.error } : {}) });
      traceIds.push(r.traceId);
    }
    return { turns, traceIds, sessionId };
  }

  // ─── webhook ingress ────────────────────────────────────────────────────────

  async webhookIngress(nodeId: string, body: { message?: unknown }, providedSecret: string | undefined) {
    const node = this.rt.store.getNode(nodeId);
    if (!node || node.type !== "channel") throw new Error(`webhook: node ${nodeId} is not a channel`);
    if (node.data["active"] !== true) throw new Error("webhook: channel is not active");
    if (node.data["kind"] !== "webhook") throw new Error("webhook: channel kind is not webhook");
    const cfg = node.data["config"] as { secret?: string } | undefined;
    const secret = typeof cfg?.secret === "string" ? cfg.secret : "";
    const resolved = resolveSecrets({ secret }, ["secret"])["secret"] as string;
    if (!providedSecret || !constantTimeEqual(providedSecret, resolved)) {
      throw new Error("webhook: invalid secret");
    }
    const message = typeof body.message === "string" ? body.message : JSON.stringify(body ?? {});
    const sessionId = "wh_" + crypto.randomUUID();
    return this.run(node.canvasId, nodeId, message, sessionId);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // burn the same time, then fail
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}