/**
 * `tools` node — the agentic tool loop.
 *
 * Flow (emergent from the graph + fixed-point executor):
 *   prompt in → augment with tool schemas → prompt out → llm
 *   llm.reply in → tool_calls? → execute via toolsApi → re-prompt out
 *                → no tool_calls? → reply out (final)
 *
 * Iterations cap via maxIterations. Per-node run state lives in a module-level
 * map (v0.1: single-user, sequential runs — laws.md Guidelines).
 */

import type { NodeModule, PortValues } from "../types.js";

interface PromptShape {
  system?: string;
  messages: unknown[];
  tools?: unknown[];
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface LoopState {
  basePrompt: PromptShape;
  iterations: number;
  lastUserHash: string;
}

export function makeToolsNode(): NodeModule {
  const state = new Map<string, LoopState>();

  const hashOf = (prompt: PromptShape): string => {
    const last = [...prompt.messages].reverse().find((m) => (m as { role?: string }).role === "user");
    return JSON.stringify(last ?? "");
  };

  return {
    type: "tools",
    label: "Tool Loop",
    category: "agent",
    summary:
      "Agentic tool loop: takes PROMPT + TOOLS, runs LLM <-> tool-call iterations until a final text reply or maxIterations.",
    dataSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        maxIterations: { type: "number", default: 10 },
      },
      required: ["name"],
    },
    ports: {
      inputs: [
        { name: "prompt", type: "PROMPT", required: true },
        { name: "tools", type: "TOOLS", required: false, multiple: true },
        { name: "reply", type: "TXT", required: false },
      ],
      outputs: [
        { name: "prompt", type: "PROMPT", required: false },
        { name: "reply", type: "TXT", required: false },
      ],
    },
    async execute(ctx): Promise<PortValues> {
      const { nodeId, inputs, data } = ctx;
      const maxIterations = typeof data.maxIterations === "number" ? data.maxIterations : 10;

      const reply = inputs["reply"];
      if (reply != null) {
        const stateEntry = state.get(nodeId);
        const toolCalls = parseToolCalls(String(reply));

        if (!toolCalls || !stateEntry) {
          state.delete(nodeId);
          return { reply };
        }
        if (stateEntry.iterations >= maxIterations) {
          state.delete(nodeId);
          return { reply: "", error: `tools: maxIterations (${maxIterations}) reached` };
        }

        if (!ctx.toolsApi) {
          return { reply: "", error: "tools: no MCP connections in this runtime" };
        }

        const toolMessages: unknown[] = [];
        for (const call of toolCalls) {
          let args: unknown = {};
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            args = {};
          }
          let result: unknown;
          try {
            result = await ctx.toolsApi.call(call.function.name, args);
          } catch (err) {
            result = { error: err instanceof Error ? err.message : String(err) };
          }
          toolMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result ?? null),
          });
        }

        stateEntry.iterations++;
        const messages = [
          ...stateEntry.basePrompt.messages,
          { role: "assistant", content: null, tool_calls: toolCalls },
          ...toolMessages,
        ];
        return { prompt: { ...stateEntry.basePrompt, messages } };
      }

      const prompt = inputs["prompt"] as PromptShape | undefined;
      if (!prompt || !Array.isArray(prompt.messages)) {
        throw new Error('tools: input "prompt" (PROMPT) is required');
      }

      const rawTools = inputs["tools"];
      const toolDefs = flattenTools(rawTools);

      const prev = state.get(nodeId);
      const hash = hashOf(prompt);
      const iterations = prev && prev.lastUserHash === hash ? prev.iterations : 0;
      state.set(nodeId, { basePrompt: prompt, iterations, lastUserHash: hash });

      if (toolDefs.length === 0) {
        // No tools connected: pure passthrough (llm runs bare).
        return { prompt };
      }
      return { prompt: { ...prompt, tools: toolDefs } };
    },
  };
}

function parseToolCalls(reply: string): ToolCall[] | null {
  try {
    const parsed = JSON.parse(reply) as { tool_calls?: ToolCall[] };
    if (parsed && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      return parsed.tool_calls;
    }
    return null;
  } catch {
    return null;
  }
}

function flattenTools(raw: unknown): unknown[] {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((v) => flattenTools(v));
  }
  if (raw && typeof raw === "object") {
    const arr = (raw as { tools?: unknown }).tools;
    if (Array.isArray(arr)) return arr;
  }
  return [];
}