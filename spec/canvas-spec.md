# OpenViveksha Canvas Spec

```yaml
spec: openviveksha/canvas
version: "0.1.2"
```

A canvas is a directed graph of nodes connected by wires. Nodes hold typed
config (`data`), wires connect named ports. The runtime executes the graph on a
trigger and resolves the final `reply`. Execution semantics are defined in
[`laws.md`](laws.md); node types in [`nodes.schema.json`](nodes.schema.json).

## Local trust boundary

OpenViveksha v0.1 is a **local, single-user runtime**: it binds to
`127.0.0.1` unless explicitly told otherwise, and **a canvas is code** —
node configs and `mcp.command` values are arbitrary instructions the runtime
will execute. Treat canvas files the way you treat scripts from the internet:
only run canvases you or your AI client authored from trusted instructions.
Do not expose the HTTP server beyond localhost without adding your own
authentication. Secret values in canvas files may reference environment
variables as `${ENV_NAME}` (resolved at run start); the local MCP server is
unauthenticated by design (trust boundary = the machine).

## File format

- `spec` — constant `openviveksha/canvas`.
- `version` — spec version the file targets.
- `name` — human-readable canvas name.
- `nodes[]` — `id` (unique, URL-safe), `type` (from the node registry),
  `position` (editor hint, optional), `data` (validated against the node
  type's `dataSchema`).
- `edges[]` — `sourceId`/`targetId` with optional `sourcePort`/`targetPort`.
  When a port is omitted, the runtime uses the neighbor's first output /
  same-named port.

## Example — minimal agent (with memory)

The canonical smallest useful agent: `chat` → `role` → `chat-history` →
`provider-llm`. No harmonics, no presets — identity comes from `soulPrompt`
alone.

```yaml
spec: openviveksha/canvas
version: "0.1.2"
name: echo-agent
nodes:
  - id: chat1
    type: chat
    data: { name: Chat }
  - id: role1
    type: role
    data:
      name: Assistant
      mode: chat
      soulPrompt: You are a terse helpful assistant.
  - id: hist1
    type: chat-history
    data: { name: Memory, depth: 0 }
  - id: llm1
    type: provider-llm
    data:
      name: Local LLM
      provider: ollama
      baseUrl: http://127.0.0.1:11434/v1
      model: llama3.1:8b
      maxTokens: 8192
edges:
  - { sourceId: chat1, sourcePort: message, targetId: role1, targetPort: message }
  - { sourceId: role1, sourcePort: prompt,  targetId: hist1, targetPort: prompt  }
  - { sourceId: hist1, sourcePort: prompt,  targetId: llm1,  targetPort: prompt  }
  - { sourceId: llm1,  sourcePort: reply,   targetId: hist1, targetPort: reply   }
  - { sourceId: hist1, sourcePort: reply,   targetId: chat1, targetPort: reply   }
```

Run: `POST /api/canvas/:id/run { "startNodeId": "chat1", "message": "hi",
"sessionId": "..." }` → executor seeds `chat1` with `{ message }`, `role1`
composes the prompt, `hist1` augments it with prior turns, `llm1` answers, the
reply is recorded by `hist1` and delivered back to `chat1`, which terminates
the run (laws §10). Same `sessionId` continues the conversation.

## Example — tool-using agent (full MVP graph)

```yaml
spec: openviveksha/canvas
version: "0.1.2"
name: tool-agent
nodes:
  - id: ch1
    type: channel
    data:
      name: Trigger
      kind: webhook
      config: { secret: "${EXAMPLE_WEBHOOK_SECRET}" }
      active: true
  - id: chat1
    type: chat
    data: { name: Chat }
  - id: role1
    type: role
    data:
      name: Researcher
      soulPrompt: You research with tools and answer concisely.
  - id: tools1
    type: tools
    data: { name: Loop, maxIterations: 10 }
  - id: mcp1
    type: mcp
    data:
      name: Local Tools
      transport: stdio
      command: "node ./tools-server.mjs"
      active: true
  - id: llm1
    type: provider-llm
    data:
      name: Brain
      provider: openai
      baseUrl: https://api.openai.com/v1
      model: gpt-4o-mini
      maxTokens: 8192
edges:
  - { sourceId: ch1,    sourcePort: message, targetId: role1,  targetPort: message }
  - { sourceId: role1,  sourcePort: prompt,  targetId: tools1, targetPort: prompt  }
  - { sourceId: mcp1,   sourcePort: tools,   targetId: tools1, targetPort: tools   }
  - { sourceId: tools1, sourcePort: prompt,  targetId: llm1,   targetPort: prompt  }
  - { sourceId: llm1,   sourcePort: reply,   targetId: tools1, targetPort: reply   }
  - { sourceId: tools1, sourcePort: reply,   targetId: chat1,  targetPort: reply   }
```

Single entry (`ch1`), single sink (`chat1`): the run starts at the channel
(webhook trigger) and terminates when the final reply is delivered to
`chat1.reply` (laws §10). The `llm.reply -> tools.reply` back-edge delivers
the model's answer through the tool loop without deadlocking (laws §8).

## Versioning

- Spec is versioned independently of the runtime. The runtime declares which
  spec versions it executes; mismatches are errors, not warnings.
- Additive changes (new node types, new optional fields) bump the minor.
  Breaking changes bump the major and require a migration note.

## Non-goals in 0.1

Multi-tenancy, auth beyond webhook secrets, remote deployment, scheduling,
embeddings/audio ports, and marketplace concerns. OpenViveksha proves one
thing: **an AI client can program an executable agent system through MCP.**