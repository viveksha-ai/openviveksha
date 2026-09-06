# OpenViveksha — MCP Tools Contract

v0.1.2 · The local MCP server is the programming surface: an AI client
(OpenCode, Claude Code, any MCP host) builds and runs canvases through these
tools. Transports: **stdio** (primary, for CLI clients) and
**http://127.0.0.1** (for local hosts). No authentication — trust boundary is
the machine (see canvas-spec.md, Local trust boundary).

Every tool returns `{ ok: true, ...payload }` or
`{ ok: false, error: string }`. Errors are descriptive: they name the field,
the expected shape, and the closest valid alternative — the client is an LLM;
an actionable error saves a retry round-trip.

## Tools

### create_canvas
```json
{ "name": "demo-agent" } → { "ok": true, "canvas": { "id": "cv_…", "name": "demo-agent" } }
```

### list_nodes
```json
{} → { "ok": true, "types": [ { "type": "role", "label": "Role", "summary": "…",
  "dataSchema": {…}, "ports": { "inputs": […], "outputs": […] } } ] }
```
Lists every registered node type with its config schema and ports. Call this
first; never guess node shapes.

### get_node_schema
```json
{ "type": "role" } → { "ok": true, "type": "role", "dataSchema": {…}, "ports": {…} }
```
One node type's full contract. Unknown `type` → error listing available types.

### create_node
```json
{ "canvasId": "cv_…", "type": "role", "data": { "name": "R", "soulPrompt": "You are…" },
  "position": { "x": 0, "y": 0 } }        // position optional
→ { "ok": true, "node": { "id": "node_…", "type": "role", "data": { "name": "R",
    "soulPrompt": "…", "temperature": 0 } } }
```
- Server validates `data` against the type's `dataSchema` **and applies
  defaults**: the response `node.data` is the effective config — the client
  should treat it as the source of truth.
- Secret values may be `${ENV_NAME}` references (resolved at run start).
- Unknown fields → error naming the closest known field.

### update_node
```json
{ "canvasId": "cv_…", "nodeId": "node_…", "data": { … } }
→ { "ok": true, "node": { …effective data… } }
```
Full replacement of `data` (validated, defaults applied). The response echoes
the effective data so the client can verify what stuck.

### delete_node
```json
{ "canvasId": "cv_…", "nodeId": "node_…" } → { "ok": true }
```
Removes the node and its edges.

### create_edge
```json
{ "canvasId": "cv_…", "sourceId": "node_a", "sourcePort": "prompt",
  "targetId": "node_b", "targetPort": "prompt" }
→ { "ok": true, "edge": { "id": "edge_…", … } }
```
- **`sourcePort` and `targetPort` are REQUIRED here** (unlike canvas files):
  an AI client must never rely on defaults. Unknown port name → error listing
  the node's actual ports. Port-type mismatch → error (`PROMPT` wire into a
  `TXT` port is rejected).
- Self-edge (source === target) → error.

### delete_edge
```json
{ "canvasId": "cv_…", "edgeId": "edge_…" } → { "ok": true }
```

### validate_canvas
```json
{ "canvasId": "cv_…" }
→ { "ok": true, "valid": true, "errors": [], "warnings": [
    "provider-llm node 'llm1': maxTokens < 8192 with a tools wire attached —
     tool arguments may be truncated",
    "channel node 'ch1' is active but not the start of any run path" ] }
```
The static checker an AI client should call before `run_canvas`:
- dangling edge endpoints; unknown port names; port-type mismatches
- required input ports with no wired edge at all
- `data` fails `dataSchema` for any node
- cycle risk report (cycles are legal — laws §8/§9 handle them — but are
  reported for review)
- heuristics as warnings (never errors): `maxTokens < 8192` with a tools
  wire; `mcp`/`channel` nodes with `active: false`; `chat-history` without
  any `reply` wire back to it.

### run_canvas
```json
{ "canvasId": "cv_…", "startNodeId": "node_…", "message": "…",
  "sessionId": "…" }
→ { "ok": true, "reply": "…", "warnings": [], "traceId": "trc_…" }
```
- `startNodeId` optional: if the canvas has exactly one `io`-category node
  (channel/chat), it is the start; otherwise → error listing candidates.
- `sessionId` optional; omit for a stateless run, pass a stable id to
  continue a conversation (chat-history memory).
- Result shape (laws §10): `reply` (string), `warnings` (array, always
  present), `error` (string, only when no reply was produced), `traceId`.

### test_agent
```json
{ "canvasId": "cv_…", "messages": ["hello", "and again"] }
→ { "ok": true, "turns": [ { "message": "hello", "reply": "…" },
                            { "message": "and again", "reply": "…" } ],
    "traceIds": ["trc_…", "trc_…"] }
```
Convenience multi-turn check: picks the start node like `run_canvas`, keeps
one `sessionId` across the messages, returns every turn. This is how an AI
client verifies the agent it just built actually works.

## Client workflow (what a competent AI client does)

1. `create_canvas` — make a canvas; `list_nodes` / `get_node_schema` — learn the vocabulary.
2. `create_node` ×N — read the effective data in each response.
3. `create_edge` with explicit ports.
4. `validate_canvas` — fix warnings/errors it understands.
5. `run_canvas` (or `test_agent`) — read `reply`, `warnings`, and on failure
   `get_trace`-style debugging via the trace observations in the HTTP API.
6. Update nodes/edges and repeat from 4.