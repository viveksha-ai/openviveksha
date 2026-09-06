# OpenViveksha

**AI can program AI agents.**

OpenViveksha is a minimal open agent runtime where the *programmer* is an AI
client. OpenCode, Claude Code, or any MCP host builds an executable agent
system — nodes, wires, validation, runs, tests — through a local MCP server.
No SaaS. No cloud. One SQLite file.

```text
YOU (or your AI client):        "Build an agent that digests this repo's
                                 changelog into a weekly post."
OpenCode / Claude Code:         list_nodes → create_node ×6 → create_edge ×5
                                validate_canvas → run_canvas
Result:                         a working agent, one SQLite file away.
```

We proved it the hard way first: a production news site is maintained by an
agent that an AI client assembled through this exact MCP workflow — nodes,
wires, validation, runs — on a live schedule.

- **Spec-first** — the canvas is a *language*: `spec/nodes.schema.json`
  (7 node types), `spec/canvas-spec.md` (file format), `spec/laws.md`
  (14 testable execution laws).
- **Local MCP** — 11 tools, from `create_canvas` and `create_node` to
  `validate_canvas` and `test_agent`. Everything an AI client needs to
  author, check, and run.
- **7 nodes**: `channel`, `chat`, `chat-history`, `role`, `provider-llm`,
  `tools`, `mcp`. Not enough? The executor tolerates any creation order and
  any graph shape — write your own node modules and extend the runtime.
- **Zero cloud.** SQLite storage, localhost HTTP, stdio MCP.

## Quickstart

```bash
git clone https://github.com/viveksha-ai/openviveksha && cd openviveksha
npm install && npm run build

# start the runtime (HTTP on 127.0.0.1:8031 + MCP on /mcp)
node dist/cli.js serve --db ./agent.sqlite
```

### Let an AI client program it

Point your MCP host at the stdio server:

<details>
<summary>OpenCode — <code>.opencode.json</code></details>

```json
{
  "mcp": {
    "openviveksha": {
      "type": "local",
      "command": ["node", "/path/to/openviveksha/dist/cli.js", "mcp", "--db", "/path/to/agent.sqlite"]
    }
  }
}
```

</details>

<details>
<summary>Claude Code — <code>.mcp.json</code></details>

```json
{
  "mcpServers": {
    "openviveksha": {
      "command": "node",
      "args": ["/path/to/openviveksha/dist/cli.js", "mcp", "--db", "/path/to/agent.sqlite"]
    }
  }
}
```

</details>

Then just ask:

> Build an agent that takes a changelog file and writes a human-readable
> digest to digest.md. Create the nodes and wires with the MCP tools,
> validate the canvas, then run it with test_agent.

The client will call `list_nodes`, create the graph (`chat → role →
chat-history → provider-llm`, reply wired back), validate, run, and report.
See `examples/demo.mjs` for the same workflow as a deterministic script.

## The graph

```text
[channel webhook] ──message──▶ [role] ──prompt──▶ [tools] ──prompt──▶ [provider-llm]
                                     ▲                │  ▲             │
[mcp source] ──────tools─────────────┘                └── reply ──────┘
[chat] ◀──reply── (final answer, laws §10)
```

The agentic tool loop is not hardcoded — it *emerges* from the execution
laws: the `tools` node re-prompts, the executor's fixed point re-runs the
`llm`, and the graph stabilizes when the model stops calling tools.

## Trust boundary (read this)

v0.1 is a local, single-user runtime. **A canvas is code**: `mcp.command`
values and node configs are executed by your machine. The HTTP server binds
`127.0.0.1` unless you explicitly say otherwise. Secrets live as
`${ENV_NAME}` references, resolved at run start, and never re-enter API
responses or traces. Details: `spec/canvas-spec.md`, `SECURITY.md`.

## Writing your own nodes

A node is one object against a tiny contract (`src/types.ts`): a manifest, a
JSON-Schema `dataSchema`, typed ports (`TXT`, `PROMPT`, `TOOLS`, `ANY`), and
`execute(ctx)`. Register it, and AI clients can program with it immediately.
Your package, your license — see `TRADEMARKS.md` for naming rules.

## Project layout

```text
spec/                 the language: node registry, canvas format, laws, MCP contract
src/                  the runtime (TypeScript, Node 22+, SQLite)
src/nodes/            the 7 built-in node modules
examples/demo.mjs     deterministic demo: an MCP client builds an agent
```

## License & trademarks

Code: [Apache-2.0](LICENSE). The names OpenViveksha / Viveksha are trademarks
of the author and are not covered by the code license — [TRADEMARKS.md](TRADEMARKS.md).
Third-party nodes carry their own licenses; the runtime does not endorse them.

Viveksha PRO — the hosted commercial platform built by the same author —
shares the canvas idea, not this codebase: harmonics, resonance, cognitive
architecture, multi-tenancy, and integrations live there, not here.