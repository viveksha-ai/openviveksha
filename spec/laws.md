# OpenViveksha — Laws of Nodes

v0.1.2 (post-review, 2026-09-06) · These laws define graph execution. The
runtime is valid only if it obeys them; node authors may rely on every law.
Each law is testable. Node/execution states: **seeded** (start node, §5),
**executed** (has an output), **failed** (finished with no output, §8),
**inert** (no module registered).

## Wires

**§1 A wire is undirected.** An edge is a bidirectional wire with one shared
name: its `sourcePort` (the target port defaults to the same name). Each
endpoint publishes on the wire (its output under that name) and subscribes to
it (reads the *other* endpoint's output under that name). Collection ≠
waiting: reading values from outgoing edges never blocks its owner.

**§2 Only incoming edges make a node ready.** Outgoing edges deliver outputs
to neighbors; they are never waited on.

**§3 Fan-out is an array.** Multiple edges delivering values into the same
input port collect into an array in wire order: the order edges appear in the
canvas file; runtime-created edges append in creation order.

**§4 Ports are named and typed.** An edge names `sourcePort` and
`targetPort`; an omitted `targetPort` defaults to the `sourcePort`; an omitted
`sourcePort` defaults to the neighbor's first output (the first entry of the
neighbor's `ports.outputs` in the node registry). Port types: `TXT`, `PROMPT`,
`TOOLS`, `ANY` (see `nodes.schema.json`).

## Execution

**§5 Seed.** A run starts at one start node with a user `message`. The start
node is seeded with output `{ message }` without executing its module. The
start node never re-executes and never republishes a received reply.

**§6 Reachability.** The executed subgraph is every node reachable from the
start node in BOTH directions along wires. Everything else is ignored.

**§7 Required ports (port-level).** A required input port is satisfied when
AT LEAST ONE incoming edge targeting it delivers a value. A node whose
required port is never satisfied does not run; if no further delivery is
possible, the run ends with an error naming the unsatisfied input.

**§8 Optional ports (pending-source rule).** For an optional port whose edges
deliver no value: if a source node is still pending, the node waits — it must
not run before its tools source executes. Exception: a port named `reply`
never waits (back-edges close cycles; waiting on them would deadlock, e.g.
chat → role → … → reply → chat). A finished source with no value means the
input is simply absent: run. **A failed node is finished with no output**;
consumers of its optional ports run without the value, and the failure is
reported (§10). An inactive or unreachable mcp node emits `{ tools: [] }`.

**§9 Fixed point.** The executor loops: run every ready node whose inputs
changed, repeat until no node changes state ("changed" = a node produced a
new output value or received a new input value). The tool loop (prompt →
llm → tool_calls → tools → re-prompt → …) emerges from this rule.
Iteration cap scales with graph size (≥ 64 in v0.1); exceeding it is a
runtime error, never an infinite loop.

**§10 Termination and result.** The run ends when a reply value is delivered
to the start node's `reply` input; that value is the result. If the start
node's reply input has no wired edge, the result is the first non-null reply
output in completion order. Node failures do not abort the run: they ride
along as `warnings`.

**§11 Secrets.** Fields marked `secret` (API keys, tokens, webhook secrets)
are write-only through the API: reads omit the field entirely; the value is
never logged and never traced (§12). Secret values may reference environment
variables as `${ENV_NAME}`; the runtime resolves them when a run starts.

**§12 Traces are sanitized and redacted.** Every trace observation truncates
strings at 2000 chars and arrays at 50 items. Fields marked `secret` appear
as `[redacted]` in both inputs and outputs. PROMPT objects are traced as
counts/lengths only (system length, message count, tool count) — never their
content. A trace records inputs, outputs, duration, token counts, and errors
per node.

## Guidelines (non-binding)

- The executor tolerates any creation order; declaring producers (e.g. `mcp`)
  before consumers (e.g. `tools`) is good authoring style, not a requirement.
- Node authors: `execute(ctx)` receives `{ nodeId, canvasId, sessionId,
  inputs, data, logger, canvasApi, httpApi, toolsApi?, trace? }` and returns
  an output object keyed by output port names. Throw to fail the node
  (finished with no output; reported, not fatal).
- PROMPT (the object carried on `PROMPT` wires) is normative:
  `{ system: string, messages: [{ role: "user" | "assistant" | "tool",
  content: string, toolCalls?, toolCallId? }], tools?: [{ name, description,
  inputSchema }] }`. `role` creates `messages = [{ role: "user",
  content: message }]`; `chat-history` inserts stored turns before the current
  user turn; `provider-llm` maps it 1:1 to `/chat/completions`.
- Set `maxTokens >= 8192` on LLM nodes when the graph uses tool calls —
  smaller budgets truncate JSON tool arguments.
- OpenViveksha v0.1 runs locally and trusts its operator: **a canvas is
  code** (an `mcp.command` is arbitrary code execution) and the HTTP server
  binds to 127.0.0.1 unless explicitly told otherwise. Network egress policy
  for nodes (a hardened net-guard) is a hardened-edition concern, not part of
  this spec.