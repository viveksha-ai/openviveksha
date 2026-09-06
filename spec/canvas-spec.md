# OpenViveksha Canvas Spec

```yaml
spec: openviveksha/canvas
version: "0.1.0"
```

A canvas is a directed graph of nodes connected by wires. Nodes hold typed
config (`data`), wires connect named ports. The runtime executes the graph on a
trigger and resolves the final `reply`. Execution semantics are defined in
[`laws.md`](laws.md); node types in [`nodes.schema.json`](nodes.schema.json).

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

## Example — minimal agent

```yaml
spec: openviveksha/canvas
version: "0.1.0"
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
  - { sourceId: role1, sourcePort: prompt,  targetId: llm1,  targetPort: prompt  }
  - { sourceId: llm1,  sourcePort: reply,   targetId: chat1, targetPort: reply   }
```

Run: `POST /api/canvas/:id/run { "startNodeId": "chat1", "message": "hi" }`
→ executor seeds `chat1` with `{ message }`, `role1` composes the prompt,
`llm1` answers, the reply flows back to `chat1`, and the run returns the first
resolved `reply`.

## Example — tool-using agent (full MVP graph)

```yaml
spec: openviveksha/canvas
version: "0.1.0"
name: tool-agent
nodes:
  - id: ch1
    type: channel
    data:
      name: Trigger
      kind: webhook
      config: { secret: "change-me" }
      active: true
  - id: chat1
    type: chat
    data: { name: Chat }
  - id: role1
    type: role
    data:
      name: Researcher
      mode: chat
      soulPrompt: You research with tools and answer concisely.
  - id: tools1
    type: tools
    data: { name: Loop, maxIterations: 10 }
  - id: mcp1
    type: mcp
    data:
      name: Local Tools
      transport: stdio
      command: "npx -y @openviveksha/example-mcp-tools"
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
  - { sourceId: ch1,   sourcePort: message, targetId: role1,  targetPort: message }
  - { sourceId: chat1, sourcePort: message, targetId: role1,  targetPort: message }
  - { sourceId: role1, sourcePort: prompt,  targetId: tools1, targetPort: prompt  }
  - { sourceId: mcp1,  sourcePort: tools,   targetId: tools1, targetPort: tools   }
  - { sourceId: tools1, sourcePort: prompt, targetId: llm1,   targetPort: prompt  }
  - { sourceId: llm1,  sourcePort: reply,   targetId: tools1, targetPort: reply   }
  - { sourceId: tools1, sourcePort: reply,  targetId: chat1,  targetPort: reply   }
```

Multiple edges into one input port fan-in as an array (Laws §6); the
`llm.reply -> tools.reply` back-edge delivers the model's answer through the
tool loop without deadlocking (Laws §4).

## Versioning

- Spec is versioned independently of the runtime. The runtime declares which
  spec versions it executes; mismatches are errors, not warnings.
- Additive changes (new node types, new optional fields) bump the minor.
  Breaking changes bump the major and require a migration note.

## Non-goals in 0.1

Multi-tenancy, auth beyond webhook secrets, remote deployment, scheduling,
embeddings/audio ports, and marketplace concerns. OpenViveksha proves one
thing: **an AI client can program an executable agent system through MCP.**