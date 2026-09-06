/**
 * `provider-llm` node — calls an OpenAI-compatible /chat/completions endpoint
 * (Ollama exposes one too). Returns { reply }: final text, or a tool_calls
 * envelope the tools node consumes.
 *
 * Guideline (laws.md): maxTokens >= 8192 when the graph uses tool calls —
 * smaller budgets truncate JSON tool arguments.
 */

import type { NodeModule } from "../types.js";

interface PromptShape {
  system?: string;
  messages: unknown[];
  tools?: unknown[];
}

interface ChatMessage {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
}

export function makeProviderLlmNode(): NodeModule {
  return {
    type: "provider-llm",
    label: "LLM Provider",
    category: "ai",
    summary:
      "Calls an OpenAI-compatible or Ollama chat endpoint with the composed PROMPT. Returns { reply }.",
    dataSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        format: { type: "string", enum: ["CHAT", "GENERATION"], default: "CHAT" },
        provider: { type: "string", enum: ["ollama", "openai"], default: "ollama" },
        baseUrl: { type: "string", description: "e.g. http://127.0.0.1:11434/v1 (ollama)" },
        apiKey: { type: "string" },
        model: { type: "string" },
        think: { type: "string", enum: ["off", "low", "mid", "hi"], default: "off" },
        temperature: { type: "number" },
        maxTokens: { type: "number", description: ">= 8192 for tool-calling graphs." },
      },
      required: ["name", "provider", "baseUrl", "model"],
    },
    secretFields: ["apiKey"],
    ports: {
      inputs: [{ name: "prompt", type: "PROMPT", required: true }],
      outputs: [{ name: "reply", type: "TXT", required: false }],
    },
    async execute(ctx) {
      const { data, inputs, trace } = ctx;
      const prompt = inputs["prompt"] as PromptShape | undefined;
      if (!prompt || !Array.isArray(prompt.messages)) {
        throw new Error('provider-llm: input "prompt" (PROMPT) is required');
      }
      const baseUrl = String(data.baseUrl ?? "").replace(/\/+$/, "");
      const model = String(data.model ?? "");
      if (!baseUrl || !model) throw new Error("provider-llm: baseUrl and model are required");
      const apiKey = typeof data.apiKey === "string" ? data.apiKey : undefined;

      const messages: unknown[] = [];
      if (typeof prompt.system === "string" && prompt.system.length > 0) {
        messages.push({ role: "system", content: prompt.system });
      }
      messages.push(...prompt.messages);

      const body: Record<string, unknown> = { model, messages };
      if (typeof data.temperature === "number") body.temperature = data.temperature;
      if (typeof data.maxTokens === "number") body.max_tokens = data.maxTokens;
      if (prompt.tools && prompt.tools.length > 0) {
        body.tools = prompt.tools;
        body.tool_choice = "auto";
      }

      const res = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`provider-llm: HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: ChatMessage }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const msg: ChatMessage = json.choices?.[0]?.message ?? { role: "assistant", content: "" };
      const usage = json.usage ?? {};
      trace?.setTokens(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        return { reply: JSON.stringify({ tool_calls: msg.tool_calls }) };
      }
      return { reply: String(msg.content ?? "") };
    },
  };
}