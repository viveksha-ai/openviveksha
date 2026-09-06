/**
 * `chat` node — conversation entry/output. Typically the run start (seeded
 * with { message } per laws §5) and the sink that surfaces the final reply.
 */

import type { NodeModule } from "../types.js";

export function makeChatNode(): NodeModule {
  return {
    type: "chat",
    label: "Chat / Output",
    category: "io",
    summary:
      "Conversation entry/output node. Typically the run start (seeded with { message }) and the sink for the final reply.",
    dataSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    ports: {
      inputs: [{ name: "reply", type: "TXT", required: false }],
      outputs: [{ name: "message", type: "TXT", required: false }],
    },
    async execute(ctx) {
      const reply = ctx.inputs["reply"];
      if (reply != null) return { message: reply };
      return {};
    },
  };
}