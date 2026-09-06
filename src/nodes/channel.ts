/**
 * `channel` node — external trigger (webhook / local webchat).
 *
 * The message itself enters the graph as the executor seed (laws §5) via the
 * HTTP ingress; execute() handles the reply back-edge (delivery placeholder
 * for v0.1) and otherwise emits nothing.
 */

import type { NodeModule } from "../types.js";

export function makeChannelNode(): NodeModule {
  return {
    type: "channel",
    label: "Input Channel",
    category: "io",
    summary:
      "External trigger: webhook (HTTP POST with secret) or local webchat. Emits { message } on trigger.",
    dataSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: ["webhook"] },
        config: {
          type: "object",
          properties: {
            secret: { type: "string", description: "Required header X-Ingress-Secret on webhook POST." },
          },
          required: ["secret"],
        },
        webhookUrl: { type: "string", readOnly: true },
        active: { type: "boolean", default: false },
      },
      required: ["name", "kind", "config"],
    },
    secretFields: ["config"],
    ports: {
      inputs: [{ name: "reply", type: "TXT", required: false }],
      outputs: [{ name: "message", type: "TXT", required: false }],
    },
    async execute(ctx) {
      const reply = ctx.inputs["reply"];
      if (reply != null) {
        // v0.1: delivery is the run result itself; external forwarding is a
        // third-party node concern.
        return { reply };
      }
      return {};
    },
  };
}