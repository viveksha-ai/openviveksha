/**
 * MCP hub — shared manager of connections to MCP servers configured by mcp
 * nodes. The node's execute() lists tools for the graph data flow; the hub
 * keeps connections alive so `tools` nodes can call tools during runs.
 *
 * v0.1 trust model: local single-user runtime, the operator configures the
 * servers (laws.md, Guidelines). Connections are lazy and reconnect on use.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: unknown;
}

interface Connection {
  client: Client;
  tools: McpToolDef[];
}

export class McpHub {
  private connections = new Map<string, Connection>();

  /** Connect (or reuse) a connection for an mcp node; returns its tools. */
  async connect(
    nodeId: string,
    cfg: { transport: "stdio" | "http"; command?: string; url?: string; authToken?: string },
  ): Promise<McpToolDef[]> {
    const existing = this.connections.get(nodeId);
    if (existing) return existing.tools;

    const client = new Client({ name: "openviveksha", version: "0.1.0" });
    if (cfg.transport === "http") {
      if (!cfg.url) throw new Error("mcp: url is required for http transport");
      const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: cfg.authToken
          ? { headers: { authorization: `Bearer ${cfg.authToken}` } }
          : undefined,
      });
      await client.connect(transport);
    } else {
      if (!cfg.command) throw new Error("mcp: command is required for stdio transport");
      const [cmd, ...args] = cfg.command.split(/\s+/);
      const transport = new StdioClientTransport({ command: cmd!, args });
      await client.connect(transport);
    }

    const listed = await client.listTools();
    const tools: McpToolDef[] = (listed.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    const conn: Connection = { client, tools };
    this.connections.set(nodeId, conn);
    return tools;
  }

  disconnect(nodeId: string): void {
    const conn = this.connections.get(nodeId);
    if (conn) {
      conn.client.close().catch(() => {});
      this.connections.delete(nodeId);
    }
  }

  /** Route a tool call to whichever connection exposes the tool. */
  async callTool(toolName: string, args: unknown): Promise<unknown> {
    for (const conn of this.connections.values()) {
      const tool = conn.tools.find((t) => t.name === toolName);
      if (!tool) continue;
      const res = await conn.client.callTool({
        name: toolName,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
      return res;
    }
    throw new Error(`mcp: no connected server exposes tool "${toolName}"`);
  }

  isActive(nodeId: string): boolean {
    return this.connections.has(nodeId);
  }
}