/**
 * `chat-history` node — conversation memory (passthrough).
 *
 * On `prompt`: injects prior turns and records the current user turn.
 * On `reply`: records the assistant turn and passes the reply through.
 * Recording happens HERE (not in the server) so the node stays the single
 * owner of its storage and graphs without history stay stateless.
 */

import type { NodeModule } from "../types.js";
import type { Store } from "../store.js";

interface PromptShape {
  system?: string;
  messages: { role: string; content: string }[];
}

export function makeChatHistoryNode(store: Store): NodeModule {
  return {
    type: "chat-history",
    label: "Conversation History",
    category: "agent",
    summary:
      "Memory passthrough: injects prior conversation turns into the prompt and records new turns. Gives an agent memory across runs (per session).",
    dataSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        depth: { type: "number", default: 0, description: "How many recent turns to inject; 0 = all." },
        format: { type: "string", enum: ["full", "compressed", "summary"], default: "full" },
      },
      required: ["name"],
    },
    ports: {
      inputs: [
        { name: "prompt", type: "PROMPT", required: false },
        { name: "reply", type: "TXT", required: false },
      ],
      outputs: [
        { name: "prompt", type: "PROMPT", required: false },
        { name: "reply", type: "TXT", required: false },
      ],
    },
    async execute(ctx) {
      const { canvasId, sessionId, inputs, data } = ctx;
      const depth = typeof data.depth === "number" && data.depth > 0 ? data.depth : 0;

      const prompt = inputs["prompt"] as PromptShape | undefined;
      if (prompt && Array.isArray(prompt.messages)) {
        // Prior turns first (current message is already in prompt.messages);
        // then record this run's user turn — order stays user→assistant.
        const prior = store.getHistory(canvasId, sessionId, depth).map((t) => ({
          role: t.role === "assistant" ? "assistant" : "user",
          content: t.content,
        }));
        const lastUser = [...prompt.messages].reverse().find((m) => m.role === "user");
        if (lastUser) store.appendTurn(canvasId, sessionId, "user", lastUser.content);
        return { prompt: { ...prompt, messages: [...prior, ...prompt.messages] } };
      }

      const reply = inputs["reply"];
      if (reply != null) {
        store.appendTurn(canvasId, sessionId, "assistant", String(reply));
        return { reply };
      }
      return {};
    },
  };
}