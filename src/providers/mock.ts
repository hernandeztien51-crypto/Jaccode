import type {
  Effort,
  Provider,
  StreamEvent,
  ToolResult,
  ToolSpec,
  TurnResult,
} from "../types.js";
import { emptyUsage } from "../types.js";

export type ScriptedTurn = Partial<TurnResult> & { text?: string };

/**
 * A scripted provider for tests and offline demos. Each call to `turn`
 * returns the next scripted response and records what it was sent.
 */
export class MockProvider implements Provider {
  readonly id = "mock";
  model = "mock";
  effort: Effort = "high";
  readonly received: { users: string[]; toolResults: ToolResult[][] } = { users: [], toolResults: [] };
  private history: unknown[] = [];

  constructor(private script: ScriptedTurn[]) {}

  addUserText(text: string): void {
    this.received.users.push(text);
    this.history.push({ role: "user", text });
  }

  addToolResults(results: ToolResult[]): void {
    this.received.toolResults.push(results);
    this.history.push({ role: "tool", results });
  }

  async turn(
    _system: string,
    _tools: ToolSpec[],
    onEvent: (e: StreamEvent) => void,
  ): Promise<TurnResult> {
    const next = this.script.shift();
    if (!next) throw new Error("mock script exhausted");
    const toolCalls = next.toolCalls ?? [];
    if (next.text) onEvent({ type: "text", text: next.text });
    for (const c of toolCalls) onEvent({ type: "tool_start", name: c.name });
    this.history.push({ role: "assistant", text: next.text ?? "", toolCalls });
    return {
      text: next.text ?? "",
      toolCalls,
      stop: next.stop ?? (toolCalls.length ? "tool_use" : "end"),
      usage: next.usage ?? { ...emptyUsage(), inputTokens: 100, outputTokens: 20 },
      note: next.note,
    };
  }

  reset(): void {
    this.history = [];
  }

  exportHistory(): unknown {
    return this.history;
  }

  importHistory(history: unknown): void {
    this.history = history as unknown[];
  }

  historyLength(): number {
    return this.history.length;
  }
}
