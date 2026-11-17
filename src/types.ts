// Shared types used across the agent, providers and tools.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type PermissionMode =
  /** Ask before every file change and every shell command. */
  | "ask"
  /** Apply file edits automatically, ask before shell commands. */
  | "auto-edit"
  /** Run everything without asking, except commands flagged as dangerous. */
  | "auto";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type StopKind = "end" | "tool_use" | "max_tokens" | "refusal" | "pause";

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  stop: StopKind;
  usage: Usage;
  /** Extra detail for refusals and fallbacks, shown to the user. */
  note?: string;
}

/** Streaming events a provider emits while a turn is generated. */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; name: string }
  | { type: "notice"; text: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

/**
 * A model backend. Each provider keeps the conversation in its own native
 * format, so nothing provider-specific (thinking blocks, compaction blocks,
 * fallback markers) is lost by converting through a lowest common denominator.
 */
export interface Provider {
  readonly id: string;
  model: string;
  effort: Effort;
  addUserText(text: string): void;
  addToolResults(results: ToolResult[]): void;
  turn(
    system: string,
    tools: ToolSpec[],
    onEvent: (e: StreamEvent) => void,
    signal: AbortSignal,
  ): Promise<TurnResult>;
  /** Drop the conversation and start fresh. */
  reset(): void;
  /** Serializable snapshot of the conversation, for saving sessions. */
  exportHistory(): unknown;
  importHistory(history: unknown): void;
  /** Number of messages in the native history. */
  historyLength(): number;
}

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}
