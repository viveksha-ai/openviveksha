/**
 * `role` node — composes the system prompt (SOUL) for this agent. Identity
 * comes from soulPrompt alone: no harmonics, no presets, no modes (spec v0.1,
 * critique #16).
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
        temperature: { type: "number", minimum: 0, maximum: 2 },
      },
      required: ["name", "soulPrompt"],
    },
    secretFields: ["soulPrompt"],
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
      const soul = String(data.soulPrompt ?? "");
      const prompt: PromptShape = {
        system: soul,
        messages: [{ role: "user", content: message }],
      };
      return { prompt } satisfies PortValues;
    },
  };
}