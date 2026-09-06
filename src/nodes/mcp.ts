/**
 * `mcp` node — connects to an MCP server and emits its tool definitions.
 * Emits empty on failure: never blocks the graph (spec, laws §5 note).
 */

import type { NodeModule } from "../types.js";
import type { McpHub } from "../mcp/hub.js";

export function makeMcpNode(hub: McpHub): NodeModule {
  return {
    type: "mcp",
    label: "MCP Source",
    category: "io",
    summary:
      "Connects to an MCP server (stdio or streamable HTTP) and emits its tool definitions on `tools`.",
    dataSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        transport: { type: "string", enum: ["stdio", "http"], default: "stdio" },
        command: { type: "string", description: "stdio: executable command line." },
        url: { type: "string", description: "http: server URL." },
        authToken: { type: "string", description: "Optional bearer token (http)." },
        active: { type: "boolean", default: false },
      },
      required: ["name", "transport"],
    },
    secretFields: ["authToken"],
    ports: {
      inputs: [],
      outputs: [{ name: "tools", type: "TOOLS", required: false }],
    },
    async execute(ctx) {
      const { nodeId, data } = ctx;
      if (data.active !== true) return { tools: [] };
      try {
        const tools = await hub.connect(nodeId, {
          transport: data.transport === "http" ? "http" : "stdio",
          command: typeof data.command === "string" ? data.command : undefined,
          url: typeof data.url === "string" ? data.url : undefined,
          authToken: typeof data.authToken === "string" ? data.authToken : undefined,
        });
        return { tools };
      } catch (err) {
        ctx.logger.warn(
          `mcp: connect failed for ${nodeId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return { tools: [] };
      }
    },
  };
}