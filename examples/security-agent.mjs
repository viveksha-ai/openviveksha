#!/usr/bin/env node
/**
 * OpenViveksha security-agent example — an agent that calls an *external*
 * MCP server's tools to do security work (here: GSC, a read-only AppSec
 * scanner). This proves the other half of the project's one claim: not only
 * can an MCP client *program* an agent, the programmed agent can *call other
 * MCP servers* as tools.
 *
 *   node examples/security-agent.mjs              # build + run (needs LLM + GSC)
 *   node examples/security-agent.mjs --no-llm     # build graph + validate (CI-safe)
 *
 * Graph (tool loop — laws §8/§9 cycles are legal):
 *
 *   chat ──message──▶ role ──prompt──▶ tools ◀──tools── mcp (GSC, stdio)
 *                          ▲             │ prompt
 *                          │             ▼
 *   chat ◀──reply────── tools ◀──reply── provider-llm
 *
 * The `mcp` node spawns an external MCP server over stdio and feeds its tool
 * definitions into the `tools` node, which runs the LLM <-> tool-call loop
 * until a final reply (maxIterations).
 *
 * By default it wires GSC (Git Security Checker) — a read-only AppSec scanner
 * that exposes scan_repo / scan_diff / list_findings / verify_finding over
 * MCP. Point OVX_MCP_COMMAND at ANY stdio MCP server to swap it out; the graph
 * is identical.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "dist/cli.js");
const db = resolve(root, "security-agent.sqlite");
const noLlm = process.argv.includes("--no-llm");

// External MCP server to wire in as tools. Default: GSC (read-only security
// scanner). e.g. GSC is cloned to ~/gsc-core, then:
//   OVX_MCP_COMMAND="python3 /home/you/gsc-core/gsc_mcp_server.py"
const mcpCommand = process.env.OVX_MCP_COMMAND ?? "python3 gsc_mcp_server.py";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cli, "mcp", "--db", db, ...(process.env.OVX_VERBOSE ? ["--verbose"] : [])],
});
const client = new Client({ name: "security-agent-client", version: "0.1.2" });
await client.connect(transport);

const call = async (tool, args) => {
  const res = await client.callTool({ name: tool, arguments: args ?? {} });
  const text = res.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text);
  if (!parsed.ok) throw new Error(`${tool}: ${parsed.error}`);
  return parsed;
};

// 1. A canvas.
const canvas = await call("create_canvas", { name: "security-agent" });
const canvasId = canvas.canvas.id;

// 2. Nodes — the 7 built-in types, composed. `mcp` is the key one: it spawns
//    an external MCP server and emits its tool definitions on `tools`.
const { node: chat } = await call("create_node", { canvasId: canvasId, type: "chat", data: { name: "Chat" } });
const { node: role } = await call("create_node", {
  canvasId: canvasId,
  type: "role",
  data: {
    name: "Security Analyst",
    soulPrompt:
      "You are a security analyst. Use the available tools to scan and " +
      "review code, then report findings concisely: rule, severity, file, and " +
      "the one-line fix. Do not invent findings — only report what the tools return.",
  },
});
const { node: mcp } = await call("create_node", {
  canvasId: canvasId,
  type: "mcp",
  data: { name: "GSC", transport: "stdio", command: mcpCommand, active: true },
});
const { node: tools } = await call("create_node", {
  canvasId: canvasId,
  type: "tools",
  data: { name: "Tool Loop", maxIterations: 10 },
});
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

// 3. Wires — explicit ports, typed.
const ids = { chat: chat.id, role: role.id, mcp: mcp.id, tools: tools.id, llm: llm.id };
const edges = [
  ["chat", "message", "role", "message"],
  ["role", "prompt", "tools", "prompt"],
  ["mcp", "tools", "tools", "tools"],
  ["tools", "prompt", "llm", "prompt"],
  ["llm", "reply", "tools", "reply"],
  ["tools", "reply", "chat", "reply"],
];
for (const [s, sp, t, tp] of edges) {
  await call("create_edge", { canvasId: canvasId, sourceId: ids[s], sourcePort: sp, targetId: ids[t], targetPort: tp });
}

// 4. Validate before running.
const v = await call("validate_canvas", { canvasId: canvasId });
console.log(`validate_canvas: valid=${v.valid} errors=${v.errors.length} warnings=${v.warnings.length}`);
for (const w of v.warnings ?? []) console.log(`  · ${w}`);
if (v.errors.length > 0) {
  console.error(v.errors);
  process.exit(1);
}

if (noLlm) {
  console.log("--no-llm: graph built and validated. Set OVX_LLM_URL + OVX_MCP_COMMAND to run live.");
  await client.close();
  process.exit(0);
}

// 5. Run — the agent calls scan_repo (from GSC) and reports.
const sessionId = "sec_" + crypto.randomUUID();
const run = await call("run_canvas", {
  canvasId: canvasId,
  message: "Scan the repo at " + (process.env.OVX_SCAN_TARGET ?? process.cwd()) + " and report the top findings.",
  sessionId,
});
console.log(`run reply: ${run.reply}`);
await client.close();
