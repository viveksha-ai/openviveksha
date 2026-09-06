#!/usr/bin/env node
/**
 * OpenViveksha demo — the deterministic proof of the project's one claim:
 * an MCP client programs an executable agent system.
 *
 *   node examples/demo.mjs              # builds the graph, validates, runs (needs an LLM)
 *   node examples/demo.mjs --no-llm     # builds the graph + validates, skips the run (CI-safe)
 *
 * The "AI client" here is a scripted MCP client — the same tools an LLM
 * would call. Watch it: list_nodes → create_node → create_edge →
 * validate_canvas → run_canvas.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "dist/cli.js");
const db = resolve(root, "demo.sqlite");
const noLlm = process.argv.includes("--no-llm");

const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--db", db] });
const client = new Client({ name: "demo-client", version: "0.1.2" });
await client.connect(transport);

const call = async (tool, args) => {
  const res = await client.callTool({ name: tool, arguments: args ?? {} });
  const text = res.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text);
  if (!parsed.ok) throw new Error(`${tool}: ${parsed.error}`);
  console.log(`→ ${tool}: ok`);
  return parsed;
};

// 1. Learn the vocabulary.
const { types } = await call("list_nodes");
console.log(`1. node types: ${types.map((t) => t.type).join(", ")}`);

// 2. A canvas.
const canvas = await call("create_canvas", { name: "demo-agent" });
const canvasId = canvas.canvas.id;

// 3. Create the nodes (effective data comes back — defaults applied).
const { node: chat } = await call("create_node", { canvasId: canvasId, type: "chat", data: { name: "Chat" } });
const { node: role } = await call("create_node", {
  canvasId: canvasId,
  type: "role",
  data: { name: "Digest", soulPrompt: "You answer in one short sentence." },
});
const { node: hist } = await call("create_node", { canvasId: canvasId, type: "chat-history", data: { name: "Memory" } });
const { node: llm } = await call("create_node", {
  canvasId: canvasId,
  type: "provider-llm",
  data: {
    name: "Brain",
    provider: "ollama",
    baseUrl: process.env.OVX_LLM_URL ?? "http://127.0.0.1:11434/v1",
    model: process.env.OVX_LLM_MODEL ?? "llama3.1:8b",
    maxTokens: 8192,
  },
});

// 4. Wires — explicit ports, typed.
const edges = [
  ["chat", "message", "role", "message"],
  ["role", "prompt", "hist", "prompt"],
  ["hist", "prompt", "llm", "prompt"],
  ["llm", "reply", "hist", "reply"],
  ["hist", "reply", "chat", "reply"],
];
const ids = { chat: chat.id, role: role.id, hist: hist.id, llm: llm.id };
for (const [s, sp, t, tp] of edges) {
  await call("create_edge", { canvasId: canvasId, sourceId: ids[s], sourcePort: sp, targetId: ids[t], targetPort: tp });
}

// 5. Validate before running.
const v = await call("validate_canvas", { canvasId: canvasId });
console.log(`5. validate_canvas: valid=${v.valid} errors=${v.errors.length} warnings=${v.warnings.length}`);

if (v.errors.length > 0) {
  console.error(v.errors);
  process.exit(1);
}

if (noLlm) {
  console.log("6. --no-llm: graph built and validated. The agent is one run away.");
  await client.close();
  process.exit(0);
}

// 6. Run — the agent answers, history records, reply terminates the run (§10).
const run1 = await call("run_canvas", { canvasId: canvasId, message: "Say hi in five words." });
console.log(`6. run 1 reply: ${run1.reply}`);
const run2 = await call("run_canvas", { canvasId: canvasId, message: "What did I just ask?" });
console.log(`   run 2 (with memory): ${run2.reply}`);
await client.close();