/**
 * Built-in node modules — the 7 spec types (nodes.schema.json v0.1).
 */

import type { NodeRegistry } from "../registry.js";
import type { Store } from "../store.js";
import type { McpHub } from "../mcp/hub.js";
import { makeChannelNode } from "./channel.js";
import { makeChatNode } from "./chat.js";
import { makeChatHistoryNode } from "./chat-history.js";
import { makeRoleNode } from "./role.js";
import { makeProviderLlmNode } from "./provider-llm.js";
import { makeToolsNode } from "./tools.js";
import { makeMcpNode } from "./mcp.js";

export function registerBuiltins(registry: NodeRegistry, store: Store, hub: McpHub): void {
  registry.register(makeChannelNode());
  registry.register(makeChatNode());
  registry.register(makeChatHistoryNode(store));
  registry.register(makeRoleNode());
  registry.register(makeProviderLlmNode());
  registry.register(makeToolsNode());
  registry.register(makeMcpNode(hub));
}