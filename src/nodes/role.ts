/**
 * `role` node — composes the system prompt (SOUL) for this agent. Identity
 * comes from soulPrompt alone: no harmonics, no presets (spec v0.1).
 */

import type { NodeModule, PortValues } from "../types.js";

interface PromptShape {
  system?: string;
  messages: { role: string; content: string }[];
}

export function makeRoleNode(): NodeModule {
  return {
    type: "role",
    label: "Role",
    category: "agent",
    summary:
      "Composes the system prompt (SOUL) for this agent from the incoming message. Produces a PROMPT for llm/tools.",
    dataSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        soulPrompt: { type: "string", description: "Agent identity / instructions (SOUL)." },
        mode: { type: "string", enum: ["chat", "generate"], default: "chat" },
        systemPrompt: { type: "string", description: "Optional extra system instructions." },
        temperature: { type: "number", minimum: 0, maximum: 2 },
      },
      required: ["name", "soulPrompt", "mode"],
    },
    secretFields: ["soulPrompt", "systemPrompt"],
    ports: {
      inputs: [
        { name: "message", type: "TXT", required: true },
        { name: "reply", type: "TXT", required: false },
      ],
      outputs: [
        { name: "prompt", type: "PROMPT", required: false },
        { name: "reply", type: "TXT", required: false },
      ],
    },
    async execute(ctx) {
      const { inputs, data } = ctx;
      const reply = inputs["reply"];
      if (reply != null) return { reply };

      const message = inputs["message"];
      if (typeof message !== "string" || message.length === 0) {
        throw new Error('role: input "message" (TXT) is required');
      }
      const system = [data.soulPrompt, data.systemPrompt]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join("\n\n");
      const prompt: PromptShape = {
        system,
        messages: [{ role: "user", content: message }],
      };
      return { prompt } satisfies PortValues;
    },
  };
}