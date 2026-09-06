# OpenViveksha — Laws of Nodes

v0.1 · These laws define graph execution. The runtime is valid only if it
obeys them; node authors may rely on every law. Each law is testable.

## Wires

**§1 A wire is undirected.** An edge is a bidirectional wire: each endpoint
reads the *other* endpoint's outputs. `buildInputs(node)` collects values from
ALL connected edges (incoming and outgoing). What a node receives is
determined by its neighbor's output port; what it gives is its own output
ports. Consequence: an output never blocks its owner.

**§2 Only incoming edges make a node ready.** Outgoing edges deliver outputs
to neighbors; they are never waited on.

**§3 Fan-out is an array.** Multiple edges delivering values into the same
input port collect into an array in edge order; a single value stays scalar.

**§4 Ports are named and typed.** An edge names `sourcePort` (what it takes
from the source's outputs) and `targetPort` (what it fills in the target's
inputs). Omitted ports resolve to: source → neighbor's first output key,
target → same name as source port. Port types: `TXT`, `PROMPT`, `TOOLS`,
`ANY` (see `nodes.schema.json`).

## Execution

**§5 Seed.** A run starts at one start node with a user `message`. The start
node is seeded with output `{ message }` without executing its module.

**§6 Reachability.** The executed subgraph is every node reachable from the
start node in BOTH directions along wires. Everything else is ignored.

**§7 Readiness (required inputs).** A node executes when, for every incoming
edge whose target port is `required`, the source node already has an output.

**§8 Readiness (optional inputs, pending-source rule).** If an incoming edge
targets an *optional* port and its source has no output yet:
- source still pending → **wait** (a node must not run without tools its MCP
  source will provide later);
- EXCEPT when the port is named `reply` → **do not wait** (reply back-edges
  close cycles; waiting on them deadlocks the graph);
- source finished and produced no value → the input is simply absent; run.

**§9 Fixed point.** The executor loops: run every ready node, repeat until no
node changes state. Iteration cap: `len(nodes) + 5`; exceeding it is a runtime
error, never an infinite loop.

**§10 Result.** The run result is the first node output (in completion order)
containing a non-null `reply`. Node failures do not abort the run: they are
collected and reported as `warnings` (or `error` if no reply was produced).

**§11 Creation order.** Within one graph definition, producer nodes (e.g.
`mcp`) should be created/declared before consumers (e.g. `tools`). The
executor resolves readiness dynamically, but declaration order keeps authoring
deterministic and mirrors how agents themselves assemble canvases.

## Data care

**§12 Secrets.** Fields marked `encrypted` (API keys, tokens, webhook
secrets) are write-only through the API: never returned by reads, never
logged, never included in traces.

**§13 Traces are sanitized.** Every trace observation truncates strings at
2000 chars and arrays at 50 items. A trace records inputs, outputs, duration,
token counts, and errors per node — enough to debug a run, never enough to
leak payloads.

**§14 Cache.** Node results are cached by `(nodeId, input signature)`. Any
node data or edge change invalidates the affected node's cache. A run always
starts from a clean execution cache.

## Guidelines (non-binding)

- Set `maxTokens >= 8192` on LLM nodes when the graph uses tool calls —
  smaller budgets truncate JSON tool arguments.
- Node authors: `execute(ctx)` receives `{ nodeId, inputs, data, logger,
  cache, canvasApi, httpApi, trace }` and returns an output object keyed by
  output port names. Throw to fail the node (reported, not fatal).
- OpenViveksha v0.1 runs locally and trusts its operator. Network egress
  policy for nodes (a hardened net-guard) is a hardened-edition concern, not
  part of this spec.