/**
 * Laws of Nodes — executable proofs (laws.md §1–§14).
 *
 * Uses real Store + real builtin modules where possible; LLM and MCP are
 * replaced by deterministic fakes (no network in CI).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, type Runtime } from "../index.js";
import type { NodeModule, PortValues } from "../types.js";

let rt: Runtime;
let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ovx-test-"));
  dbPath = join(dir, "test.sqlite");
  rt = createRuntime(dbPath);
});

afterEach(() => {
  rt.store.close();
  rmSync(dir, { recursive: true, force: true });
});

// ─── fakes ───────────────────────────────────────────────────────────────────

function fakeLlm(replies: (string | PortValues)[]): NodeModule {
  let call = 0;
  return {
    type: "test-llm",
    label: "Test LLM",
    category: "ai",
    summary: "deterministic fake",
    dataSchema: { type: "object", properties: {}, required: [] },
    ports: {
      inputs: [{ name: "prompt", type: "PROMPT", required: true }],
      outputs: [{ name: "reply", type: "TXT", required: false }],
    },
    async execute(ctx) {
      const r = replies[Math.min(call, replies.length - 1)];
      call++;
      if (typeof r === "string") return { reply: r };
      return r;
    },
  };
}

function captureLlm(store: { last?: unknown }): NodeModule {
  return {
    type: "test-capture-llm",
    label: "Capture LLM",
    category: "ai",
    summary: "records the prompt, returns fixed reply",
    dataSchema: { type: "object", properties: {}, required: [] },
    ports: {
      inputs: [{ name: "prompt", type: "PROMPT", required: true }],
      outputs: [{ name: "reply", type: "TXT", required: false }],
    },
    async execute(ctx) {
      store.last = ctx.inputs["prompt"];
      return { reply: "ok" };
    },
  };
}

async function setup(): Promise<{ canvasId: string }> {
  const c = rt.store.createCanvas("t");
  return { canvasId: c.id };
}

const run = (canvasId: string, startNodeId: string, message: string, sessionId = "s1") =>
  rt.executor.run({ canvasId, startNodeId, message, sessionId });

// ─── laws ────────────────────────────────────────────────────────────────────

describe("laws.md execution semantics", () => {
  it("§5 seed: the start node is not executed, it is seeded with { message }", async () => {
    const { canvasId } = await setup();
    // chat node that would fail if executed — seeded instead
    rt.registry.register({
      ...({
        type: "test-explosive",
        label: "x",
        category: "io",
        summary: "x",
        dataSchema: { type: "object", properties: {}, required: [] },
        ports: { inputs: [], outputs: [{ name: "message", type: "TXT", required: false }] },
        async execute() {
          throw new Error("MUST NOT BE CALLED ON START NODE");
        },
      } as NodeModule),
    });
    const n = rt.store.createNode(canvasId, "test-explosive", { name: "x" });
    const res = await run(canvasId, n.id, "hello");
    // No reply anywhere, but the seed worked and the loop ended gracefully.
    expect(res.reply).toBe("");
    expect(res.error).toContain("no reply");
    expect(rt.executor.getTrace(res.traceId)!.observations).toHaveLength(0);
  });

  it("§2+§7: only incoming edges block; a required input waits for its source", async () => {
    const { canvasId } = await setup();
    const llm = fakeLlm(["final"]);
    rt.registry.register(llm);
    const chat = rt.store.createNode(canvasId, "chat", { name: "C" });
    const role = rt.store.createNode(canvasId, "role", {
      name: "R",
      soulPrompt: "Soul",
      mode: "chat",
    });
    const llmN = rt.store.createNode(canvasId, "test-llm", {});
    rt.store.createEdge(canvasId, chat.id, role.id, "message", "message");
    rt.store.createEdge(canvasId, role.id, llmN.id, "prompt", "prompt");
    const res = await run(canvasId, chat.id, "hi");
    expect(res.reply).toBe("final");
  });

  it("§8 pending optional source blocks: consumer created BEFORE its producer", async () => {
    const { canvasId } = await setup();
    // created_at order: consumer first, producer later — like PRO news-canvas
    // (tools before mcp). The consumer must still wait for producer's tools.
    let consumerSawTools: unknown = "unset";
    rt.registry.register({
      type: "test-consumer",
      label: "C",
      category: "agent",
      summary: "x",
      dataSchema: { type: "object", properties: {}, required: [] },
      ports: {
        inputs: [
          { name: "prompt", type: "PROMPT", required: true },
          { name: "tools", type: "TOOLS", required: false },
        ],
        outputs: [
          { name: "prompt", type: "PROMPT", required: false },
          { name: "reply", type: "TXT", required: false },
        ],
      },
      async execute(ctx) {
        consumerSawTools = ctx.inputs["tools"];
        return { prompt: ctx.inputs["prompt"] };
      },
    } as NodeModule);
    rt.registry.register({
      type: "test-producer",
      label: "P",
      category: "io",
      summary: "x",
      dataSchema: { type: "object", properties: {}, required: [] },
      ports: {
        inputs: [],
        outputs: [{ name: "tools", type: "TOOLS", required: false }],
      },
      async execute() {
        return { tools: [{ name: "t1", inputSchema: {} }] };
      },
    } as NodeModule);
    rt.registry.register(fakeLlm(["done"]));

    const chat = rt.store.createNode(canvasId, "chat", { name: "C" });
    const consumer = rt.store.createNode(canvasId, "test-consumer", {}); // created FIRST
    const producer = rt.store.createNode(canvasId, "test-producer", {}); // created AFTER
    const llmN = rt.store.createNode(canvasId, "test-llm", {});
    rt.store.createEdge(canvasId, producer.id, consumer.id, "tools", "tools");
    rt.store.createEdge(canvasId, chat.id, consumer.id, "message", "prompt");
    rt.store.createEdge(canvasId, consumer.id, llmN.id, "prompt", "prompt");

    const res = await run(canvasId, chat.id, "hi");
    expect(res.reply).toBe("done");
    expect(consumerSawTools).toEqual([{ name: "t1", inputSchema: {} }]);
  });

  it("§8 reply exception: a reply back-edge never deadlocks the graph", async () => {
    const { canvasId } = await setup();
    rt.registry.register(fakeLlm(["llm-final"]));
    const chat = rt.store.createNode(canvasId, "chat", { name: "C" });
    const role = rt.store.createNode(canvasId, "role", {
      name: "R",
      soulPrompt: "Soul",
      mode: "chat",
    });
    const llm = rt.store.createNode(canvasId, "test-llm", {});
    rt.store.createEdge(canvasId, chat.id, role.id, "message", "message");
    rt.store.createEdge(canvasId, role.id, llm.id, "prompt", "prompt");
    rt.store.createEdge(canvasId, llm.id, chat.id, "reply", "reply");
    const res = await run(canvasId, chat.id, "hi");
    expect(res.reply).toBe("llm-final");
  });

  it("§1 undirected wire: a node reads its outgoing neighbor's outputs", async () => {
    const { canvasId } = await setup();
    // B has NO incoming edges, only an outgoing edge to the start node; per §1
    // it still receives the start node's seeded output.
    let sawMessage: unknown = undefined;
    rt.registry.register({
      type: "test-reader",
      label: "R",
      category: "io",
      summary: "x",
      dataSchema: { type: "object", properties: {}, required: [] },
      ports: {
        inputs: [{ name: "in", type: "TXT", required: false }],
        outputs: [{ name: "reply", type: "TXT", required: false }],
      },
      async execute(ctx) {
        sawMessage = ctx.inputs["in"];
        return { reply: "read" };
      },
    } as NodeModule);
    const start = rt.store.createNode(canvasId, "chat", { name: "C" });
    const reader = rt.store.createNode(canvasId, "test-reader", {});
    // Wire named "message": reader subscribes to the start node's seeded
    // output via the undirected wire (§1) into its own `in` port.
    rt.store.createEdge(canvasId, reader.id, start.id, "message", "in");
    await run(canvasId, start.id, "seed-text");
    expect(sawMessage).toBe("seed-text");
  });

  it("§3 fan-out: two edges into one port collect into an array", async () => {
    const { canvasId } = await setup();
    let saw: unknown;
    rt.registry.register({
      type: "test-fanin",
      label: "F",
      category: "io",
      summary: "x",
      dataSchema: { type: "object", properties: {}, required: [] },
      ports: {
        inputs: [{ name: "in", type: "TXT", required: false }],
        outputs: [{ name: "reply", type: "TXT", required: false }],
      },
      async execute(ctx) {
        saw = ctx.inputs["in"];
        return { reply: "x" };
      },
    } as NodeModule);
    rt.registry.register({
      type: "test-source",
      label: "S",
      category: "io",
      summary: "x",
      dataSchema: { type: "object", properties: {}, required: [] },
      ports: { inputs: [], outputs: [{ name: "out", type: "TXT", required: false }] },
      async execute() {
        return { out: "A" };
      },
    } as NodeModule);
    const start = rt.store.createNode(canvasId, "chat", { name: "C" });
    const s1 = rt.store.createNode(canvasId, "test-source", { v: 1 });
    const s2 = rt.store.createNode(canvasId, "test-source", { v: 2 });
    const fan = rt.store.createNode(canvasId, "test-fanin", {});
    rt.store.createEdge(canvasId, start.id, fan.id, "message", "in");
    rt.store.createEdge(canvasId, s1.id, fan.id, "out", "in");
    rt.store.createEdge(canvasId, s2.id, fan.id, "out", "in");
    await run(canvasId, start.id, "seed");
    expect(saw).toHaveLength(3);
    expect(saw).toEqual(expect.arrayContaining(["seed", "A", "A"]));;
  });

  it("§9 fixed point terminates: a graph that never replies ends with a graceful error", async () => {
    const { canvasId } = await setup();
    const chat = rt.store.createNode(canvasId, "chat", { name: "C" });
    const other = rt.store.createNode(canvasId, "chat", { name: "D" });
    // both nodes produce nothing (chat only echoes reply); no edge to any llm.
    rt.store.createEdge(canvasId, chat.id, other.id, "message", "reply");
    const res = await run(canvasId, chat.id, "hi");
    expect(res.reply).toBe("");
    expect(res.error).toBeTruthy();
  });

  it("§10 first reply wins; a failed node rides along as a warning", async () => {
    const { canvasId } = await setup();
    rt.registry.register(fakeLlm(["good"]));
    rt.registry.register({
      type: "test-broken",
      label: "B",
      category: "io",
      summary: "x",
      dataSchema: { type: "object", properties: {}, required: [] },
      ports: {
        inputs: [{ name: "message", type: "TXT", required: false }],
        outputs: [{ name: "reply", type: "TXT", required: false }],
      },
      async execute() {
        throw new Error("boom");
      },
    } as NodeModule);
    const chat = rt.store.createNode(canvasId, "chat", { name: "C" });
    const llm = rt.store.createNode(canvasId, "test-llm", {});
    const broken = rt.store.createNode(canvasId, "test-broken", {});
    rt.store.createEdge(canvasId, chat.id, llm.id, "message", "prompt");
    rt.store.createEdge(canvasId, chat.id, broken.id, "message", "message");
    const res = await run(canvasId, chat.id, "hi");
    expect(res.reply).toBe("good");
    expect(res.warnings?.[0]).toContain("boom");
  });

  it("§13 traces are sanitized: long strings truncate at 2000 chars", async () => {
    const { canvasId } = await setup();
    const long = "x".repeat(3000);
    rt.registry.register({
      type: "test-long",
      label: "L",
      category: "io",
      summary: "x",
      dataSchema: { type: "object", properties: {}, required: [] },
      ports: {
        inputs: [{ name: "in", type: "ANY", required: false }],
        outputs: [{ name: "reply", type: "TXT", required: false }],
      },
      async execute() {
        return { reply: long };
      },
    } as NodeModule);
    const chat = rt.store.createNode(canvasId, "chat", { name: "C" });
    const n = rt.store.createNode(canvasId, "test-long", {});
    rt.store.createEdge(canvasId, chat.id, n.id, "message", "in");
    const res = await run(canvasId, chat.id, "m");
    expect(res.reply).toHaveLength(3000); // result itself is not truncated
    const obs = rt.executor.getTrace(res.traceId)!.observations[0];
    expect((obs.output["reply"] as string).length).toBeLessThan(3000);
    expect(obs.output["reply"]).toContain("...[truncated]");
  });

  it("role node: composes system from soulPrompt (+systemPrompt)", async () => {
    const { canvasId } = await setup();
    const capture: { last?: unknown } = {};
    rt.registry.register(captureLlm(capture));
    const chat = rt.store.createNode(canvasId, "chat", { name: "C" });
    const role = rt.store.createNode(canvasId, "role", {
      name: "R",
      soulPrompt: "SOUL-1",
      systemPrompt: "EXTRA-2",
      mode: "chat",
    });
    const llm = rt.store.createNode(canvasId, "test-capture-llm", {});
    rt.store.createEdge(canvasId, chat.id, role.id, "message", "message");
    rt.store.createEdge(canvasId, role.id, llm.id, "prompt", "prompt");
    await run(canvasId, chat.id, "hi");
    const prompt = capture.last as { system: string; messages: { content: string }[] };
    expect(prompt.system).toContain("SOUL-1");
    expect(prompt.system).toContain("EXTRA-2");
    expect(prompt.messages[0]!.content).toBe("hi");
  });

  it("chat-history: second run in the same session sees prior turns", async () => {
    const { canvasId } = await setup();
    const capture: { last?: unknown } = {};
    rt.registry.register(captureLlm(capture));
    const chat = rt.store.createNode(canvasId, "chat", { name: "C" });
    const role = rt.store.createNode(canvasId, "role", {
      name: "R",
      soulPrompt: "S",
      mode: "chat",
    });
    const hist = rt.store.createNode(canvasId, "chat-history", { name: "H", depth: 0 });
    const llm = rt.store.createNode(canvasId, "test-capture-llm", {});
    rt.store.createEdge(canvasId, chat.id, role.id, "message", "message");
    rt.store.createEdge(canvasId, role.id, hist.id, "prompt", "prompt");
    rt.store.createEdge(canvasId, hist.id, llm.id, "prompt", "prompt");
    rt.store.createEdge(canvasId, llm.id, hist.id, "reply", "reply");
    rt.store.createEdge(canvasId, hist.id, chat.id, "reply", "reply");

    await run(canvasId, chat.id, "first", "sess-1");
    await run(canvasId, chat.id, "second", "sess-1");
    const msgs = (capture.last as { messages: { role: string; content: string }[] }).messages;
    const contents = msgs.map((m) => m.content);
    expect(contents).toContain("first");
    expect(contents).toContain("ok");
    expect(contents.indexOf("first")).toBeLessThan(contents.indexOf("second"));
    // other sessions are isolated
    const h2 = rt.store.getHistory(canvasId, "sess-2", 0);
    expect(h2).toHaveLength(0);
  });

  it("tools loop: executes tool_calls and feeds results back until final text", async () => {
    const { canvasId } = await setup();
    let llmCall = 0;
    rt.registry.register({
      type: "test-tool-llm",
      label: "L",
      category: "ai",
      summary: "x",
      dataSchema: { type: "object", properties: {}, required: [] },
      ports: {
        inputs: [{ name: "prompt", type: "PROMPT", required: true }],
        outputs: [{ name: "reply", type: "TXT", required: false }],
      },
      async execute(ctx) {
        llmCall++;
        if (llmCall === 1) {
          return {
            reply: JSON.stringify({
              tool_calls: [
                { id: "c1", function: { name: "echo", arguments: JSON.stringify({ v: 42 }) } },
              ],
            }),
          };
        }
        const msgs = (ctx.inputs["prompt"] as { messages: unknown[] }).messages;
        expect(msgs.some((m) => (m as { role?: string }).role === "tool")).toBe(true);
        return { reply: "tool result used" };
      },
    } as NodeModule);

    const calls: { name: string; args: unknown }[] = [];
    const rt2 = rt; // executor already wired with toolsApi → mcpHub; stub via direct constructor is not needed:
    void rt2;
    // NOTE: toolsApi comes from the runtime (mcpHub). For this test we inject
    // a stub by re-creating the executor with a stub ToolsApi.
    const { GraphExecutor } = await import("../executor.js");
    const canvasApi = {
      getNode: (id: string) => rt.store.getNode(id) ?? null,
      getNeighbors: () => [],
      getEdges: (cid: string) => rt.store.listEdges(cid),
    };
    const stubExecutor = new GraphExecutor(
      rt.registry,
      canvasApi,
      (cid: string) => rt.store.listNodes(cid),
      (cid: string) => rt.store.listEdges(cid),
      { call: async (name: string, args: unknown) => { calls.push({ name, args }); return { echoed: args }; } },
    );

    const chat = rt.store.createNode(canvasId, "chat", { name: "C" });
    const role = rt.store.createNode(canvasId, "role", {
      name: "R",
      soulPrompt: "S",
      mode: "chat",
    });
    const toolsN = rt.store.createNode(canvasId, "tools", { name: "T", maxIterations: 5 });
    const llmN = rt.store.createNode(canvasId, "test-tool-llm", {});
    rt.store.createEdge(canvasId, chat.id, role.id, "message", "message");
    rt.store.createEdge(canvasId, role.id, toolsN.id, "prompt", "prompt");
    rt.store.createEdge(canvasId, toolsN.id, llmN.id, "prompt", "prompt");
    rt.store.createEdge(canvasId, llmN.id, toolsN.id, "reply", "reply");

    const res = await stubExecutor.run({ canvasId, startNodeId: chat.id, message: "go", sessionId: "s9" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("echo");
    expect(calls[0]!.args).toEqual({ v: 42 });
    expect(res.reply).toBe("tool result used");
    expect(llmCall).toBe(2);
  });
});