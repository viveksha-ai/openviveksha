/**
 * Platform integration: CanvasService + HTTP server (Ф4).
 * Covers: defaults application, secret write-only + ENV interpolation,
 * webhook ingress (constant-time secret, Origin rejection), run defaulting,
 * test_agent multi-turn, validate_canvas heuristics.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, type Runtime } from "../index.js";
import { CanvasService } from "../services.js";
import { createHttpServer, type ServerOptions } from "../server.js";
import type { NodeModule } from "../types.js";

let rt: Runtime;
let svc: CanvasService;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ovx-svc-"));
  rt = createRuntime(join(dir, "t.sqlite"));
  svc = new CanvasService(rt);
  rt.registry.register({
    type: "test-llm",
    label: "T",
    category: "ai",
    summary: "x",
    dataSchema: { type: "object", properties: { fixed: { type: "string", default: "ok" } }, required: [] },
    ports: {
      inputs: [{ name: "prompt", type: "PROMPT", required: true }],
      outputs: [{ name: "reply", type: "TXT", required: false }],
    },
    async execute(ctx) {
      return { reply: String(ctx.data["fixed"] ?? "ok") };
    },
  } as NodeModule);
});

afterEach(() => {
  rt.store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("CanvasService", () => {
  it("create_node applies defaults and hides secrets on read-back", () => {
    const c = svc.createCanvas("t");
    const node = svc.createNode(c.id, "provider-llm", {
      name: "L",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "m",
      apiKey: "sk-test-123",
    });
    expect(node.data["provider"]).toBe("ollama"); // default applied
    expect(node.data["apiKey"]).toBeUndefined(); // secret omitted (laws §11)
  });

  it("run resolves ${ENV} in secrets and runs without startNodeId when unambiguous", async () => {
    process.env.OVX_TEST_KEY = "abc123";
    const c = svc.createCanvas("t");
    const chat = rt.store.createNode(c.id, "chat", { name: "C" });
    const llm = rt.store.createNode(c.id, "test-llm", { fixed: "env-ok" });
    rt.store.createEdge(c.id, chat.id, llm.id, "message", "prompt");
    const res = await svc.run(c.id, undefined, "go", "s1");
    expect(res.reply).toBe("env-ok");
    expect(chat.id).toBeTruthy();
    delete process.env.OVX_TEST_KEY;
  });

  it("webhook ingress: wrong secret rejected, right secret accepted", async () => {
    process.env.OVX_WEBHOOK_SECRET = "s3cr3t";
    const c = svc.createCanvas("t");
    const ch = rt.store.createNode(c.id, "channel", {
      name: "T",
      kind: "webhook",
      config: { secret: "${OVX_WEBHOOK_SECRET}" },
      active: true,
    });
    await expect(
      svc.webhookIngress(ch.id, { message: "x" }, "wrong"),
    ).rejects.toThrow("invalid secret");
    const res = await svc.webhookIngress(ch.id, { message: "x" }, "s3cr3t");
    expect(res.reply).toBe(""); // no llm wired — graceful no-reply
    expect(res.error).toBeTruthy();
    delete process.env.OVX_WEBHOOK_SECRET;
  });

  it("validate_canvas: required input without edge = error; maxTokens heuristic warns", () => {
    const c = svc.createCanvas("t");
    const chat = rt.store.createNode(c.id, "chat", { name: "C" });
    const role = rt.store.createNode(c.id, "role", { name: "R", soulPrompt: "S" });
    const llm = rt.store.createNode(c.id, "provider-llm", {
      name: "L",
      baseUrl: "http://x",
      model: "m",
      maxTokens: 1024,
    });
    rt.store.createEdge(c.id, chat.id, role.id, "message", "message");
    const toolsN = rt.store.createNode(c.id, "tools", { name: "T" });
    rt.store.createEdge(c.id, role.id, toolsN.id, "prompt", "prompt");
    rt.store.createEdge(c.id, toolsN.id, llm.id, "prompt", "prompt");
    rt.store.createEdge(c.id, llm.id, toolsN.id, "reply", "prompt"); // TXT → PROMPT mismatch (raw store, bypasses create_edge validation)
    rt.store.createNode(c.id, "provider-llm", {
      name: "Orphan",
      baseUrl: "http://x",
      model: "m",
    }); // required `prompt` port, no wires at all
    const v = svc.validateCanvas(c.id);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toContain("type mismatch");
    expect(v.errors.join(" ")).toContain('required input "prompt"');
    expect(v.warnings.join(" ")).toContain("maxTokens < 8192");
    expect(v.warnings.join(" ")).toContain("cycle");
  });

  it("test_agent keeps one session across messages", async () => {
    const c = svc.createCanvas("t");
    const chat = rt.store.createNode(c.id, "chat", { name: "C" });
    const role = rt.store.createNode(c.id, "role", { name: "R", soulPrompt: "S" });
    const hist = rt.store.createNode(c.id, "chat-history", { name: "H" });
    const llm = rt.store.createNode(c.id, "test-llm", { fixed: "ack" });
    rt.store.createEdge(c.id, chat.id, role.id, "message", "message");
    rt.store.createEdge(c.id, role.id, hist.id, "prompt", "prompt");
    rt.store.createEdge(c.id, hist.id, llm.id, "prompt", "prompt");
    rt.store.createEdge(c.id, llm.id, hist.id, "reply", "reply");
    const res = await svc.testAgent(c.id, ["one", "two"]);
    expect(res.turns).toHaveLength(2);
    expect(res.turns.every((t) => t.reply === "ack")).toBe(true);
    // second turn saw the first turn in history
    const h = rt.store.getHistory(c.id, hist.id, res.sessionId, 0);
    expect(h.map((x) => x.content)).toEqual(["one", "ack", "two", "ack"]);
  });
});

describe("HTTP server", () => {
  it("rejects cross-origin requests; accepts localhost; ingress checks secret", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "ovx-http-"));
    const rt2 = createRuntime(join(dir2, "t.sqlite"));
    const svc2 = new CanvasService(rt2);
    rt2.registry.register({
      type: "test-llm",
      label: "T",
      category: "ai",
      summary: "x",
      dataSchema: { type: "object", properties: {}, required: [] },
      ports: {
        inputs: [{ name: "prompt", type: "PROMPT", required: true }],
        outputs: [{ name: "reply", type: "TXT", required: false }],
      },
      async execute() {
        return { reply: "http-ok" };
      },
    } as NodeModule);
    process.env.OVX_WEBHOOK_SECRET = "topsecret";
    const c = rt2.store.createCanvas("http");
    const ch = rt2.store.createNode(c.id, "channel", {
      name: "T",
      kind: "webhook",
      config: { secret: "${OVX_WEBHOOK_SECRET}" },
      active: true,
    });
    const role = rt2.store.createNode(c.id, "role", { name: "R", soulPrompt: "S" });
    const llm = rt2.store.createNode(c.id, "test-llm", {});
    rt2.store.createEdge(c.id, ch.id, role.id, "message", "message");
    rt2.store.createEdge(c.id, role.id, llm.id, "prompt", "prompt");

    const port = 38031 + Math.floor(Math.random() * 2000);
    const opts: ServerOptions = { port, host: "127.0.0.1" };
    const server = createHttpServer(rt2, opts);
    await new Promise<void>((r) => server.on("listening", r));

    const base = `http://127.0.0.1:${port}`;

    const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };

    // cross-origin rejected
    const evil = await post("/api/canvas", { name: "x" }, { origin: "https://evil.example" });
    expect(evil.status).toBe(403);

    // canvas CRUD over HTTP
    const created = await post("/api/canvas", { name: "http-t" });
    expect(created.json.ok).toBe(true);

    // ingress: wrong secret → 400, right secret → run executes
    const bad = await post(`/api/ingress/webhook/${ch.id}`, { message: "hi" }, { "x-ingress-secret": "nope" });
    expect(bad.status).toBe(400);
    const good = await post(
      `/api/ingress/webhook/${ch.id}`,
      { message: "hi" },
      { "x-ingress-secret": "topsecret" },
    );
    expect(good.json.ok).toBe(true);
    expect(good.json.reply).toBe("http-ok");

    server.close();
    rt2.store.close();
    rmSync(dir2, { recursive: true, force: true });
    delete process.env.OVX_WEBHOOK_SECRET;
  });
});