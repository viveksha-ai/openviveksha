/**
 * Regression (issue #4): resolved secrets must never be persisted to the
 * store. ${ENV} references resolve into the in-memory run context only
 * (laws §12, §13) — the store keeps the references as written.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, type Runtime } from "../index.js";
import { CanvasService } from "../services.js";
import type { NodeModule } from "../types.js";

let rt: Runtime;
let svc: CanvasService;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ovx-sec-"));
  rt = createRuntime(join(dir, "t.sqlite"));
  svc = new CanvasService(rt);
  // Echo node: returns its secret field in the reply, so the test can assert
  // the resolved value reached execute() without being written to the store.
  rt.registry.register({
    type: "test-secret",
    label: "S",
    category: "ai",
    summary: "x",
    secretFields: ["apiKey"],
    dataSchema: { type: "object", properties: {}, required: [] },
    ports: {
      inputs: [{ name: "prompt", type: "PROMPT", required: true }],
      outputs: [{ name: "reply", type: "TXT", required: false }],
    },
    async execute(ctx) {
      return { reply: String(ctx.data["apiKey"] ?? "none") };
    },
  } as NodeModule);
});

afterEach(() => {
  rt.store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("secrets: store never persists resolved values (issue #4)", () => {
  it("run resolves ${ENV} into the run context only — store keeps the reference", async () => {
    process.env.OVX_SEC_KEY = "plain-secret-value";
    const c = svc.createCanvas("t");
    const chat = rt.store.createNode(c.id, "chat", { name: "C" });
    const node = rt.store.createNode(c.id, "test-secret", { name: "S", apiKey: "${OVX_SEC_KEY}" });
    rt.store.createEdge(c.id, chat.id, node.id, "message", "prompt");

    const res = await svc.run(c.id, undefined, "go", "s1");
    expect(res.reply).toBe("plain-secret-value"); // resolved value reached execute()
    expect(rt.store.getNode(node.id)?.data["apiKey"]).toBe("${OVX_SEC_KEY}"); // store untouched
    delete process.env.OVX_SEC_KEY;
  });

  it("missing env variable: node error, store keeps the reference", async () => {
    delete process.env.OVX_MISSING_KEY;
    const c = svc.createCanvas("t");
    const chat = rt.store.createNode(c.id, "chat", { name: "C" });
    const node = rt.store.createNode(c.id, "test-secret", { name: "S", apiKey: "${OVX_MISSING_KEY}" });
    rt.store.createEdge(c.id, chat.id, node.id, "message", "prompt");

    const res = await svc.run(c.id, undefined, "go", "s1");
    expect(res.error).toBeTruthy();
    expect(rt.store.getNode(node.id)?.data["apiKey"]).toBe("${OVX_MISSING_KEY}");
  });
});