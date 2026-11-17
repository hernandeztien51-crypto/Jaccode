import Anthropic from "@anthropic-ai/sdk";
import type {
  Effort,
  Provider,
  StreamEvent,
  ToolResult,
  ToolSpec,
  TurnResult,
} from "../types.js";
import { emptyUsage } from "../types.js";

type MessageParam = Anthropic.Beta.BetaMessageParam;

/** Models that accept the server-side refusal fallback with `fallbacks: "default"`. */
const FALLBACK_MODELS = new Set([
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

/** Models that support server-side compaction. */
const COMPACTION_MODELS = new Set([
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-5-5",
]);

export interface AnthropicOptions {
  model: string;
  effort: Effort;
  maxTokens?: number;
  showThinking?: boolean;
  client?: Anthropic;
}

/**
 * Claude via the official SDK. Streams every turn, uses adaptive thinking,
 * prompt caching, server-side compaction for long sessions and the
 * server-side refusal fallback.
 *
 * The history is append-only: assistant turns are stored exactly as returned
 * (thinking, compaction and fallback blocks included) and never edited.
 */
export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  model: string;
  effort: Effort;
  private maxTokens: number;
  private showThinking: boolean;
  private client: Anthropic;
  private messages: MessageParam[] = [];
  private pendingToolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.effort = opts.effort;
    this.maxTokens = opts.maxTokens ?? 64000;
    this.showThinking = opts.showThinking ?? true;
    this.client = opts.client ?? new Anthropic();
  }

  addUserText(text: string): void {
    this.flushToolResults([{ type: "text", text }]);
  }

  addToolResults(results: ToolResult[]): void {
    for (const r of results) {
      this.pendingToolResults.push({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
        is_error: r.isError || undefined,
      });
    }
  }

  /** Tool results and any follow-up text go into one user message. */
  private flushToolResults(extra: Anthropic.Beta.BetaContentBlockParam[] = []): void {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...this.pendingToolResults, ...extra];
    this.pendingToolResults = [];
    if (content.length > 0) this.messages.push({ role: "user", content });
  }

  async turn(
    system: string,
    tools: ToolSpec[],
    onEvent: (e: StreamEvent) => void,
    signal: AbortSignal,
  ): Promise<TurnResult> {
    this.flushToolResults();

    const betas: Anthropic.Beta.AnthropicBeta[] = [];
    const useFallback = FALLBACK_MODELS.has(this.model);
    const useCompaction = COMPACTION_MODELS.has(this.model);
    if (useFallback) betas.push("server-side-fallback-2026-07-01");
    if (useCompaction) betas.push("compact-2026-01-12");

    const apiTools: Anthropic.Beta.BetaTool[] = tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      // Large inputs (file bodies) stream as generated; inputs are validated
      // against each tool's schema before anything runs.
      eager_input_streaming: true,
      // Cache breakpoint after the last tool: tools + system form a stable prefix.
      ...(i === tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: apiTools,
        messages: this.messages,
        thinking: { type: "adaptive", display: this.showThinking ? "summarized" : "omitted" },
        output_config: { effort: this.effort },
        // Caches the growing conversation, so each turn re-reads it cheaply.
        cache_control: { type: "ephemeral" },
        ...(useFallback ? { fallbacks: "default" as const } : {}),
        ...(useCompaction
          ? { context_management: { edits: [{ type: "compact_20260112" as const }] } }
          : {}),
        ...(betas.length ? { betas } : {}),
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use") onEvent({ type: "tool_start", name: block.name });
        else if (block.type === "compaction") onEvent({ type: "notice", text: "context compacted" });
        else if (block.type === "fallback")
          onEvent({ type: "notice", text: `${block.from.model} declined; continuing on ${block.to.model}` });
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") onEvent({ type: "text", text: event.delta.text });
        else if (event.delta.type === "thinking_delta" && this.showThinking)
          onEvent({ type: "thinking", text: event.delta.thinking });
      }
    }

    const message = await stream.finalMessage();
    // Append the full content unchanged: compaction and thinking blocks must survive.
    this.messages.push({ role: "assistant", content: message.content });

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolCalls = message.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    const u = message.usage;
    const usage = {
      ...emptyUsage(),
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    };

    switch (message.stop_reason) {
      case "refusal":
        return {
          text,
          toolCalls: [],
          stop: "refusal",
          usage,
          note: message.stop_details?.explanation ?? undefined,
        };
      case "max_tokens":
        return { text, toolCalls, stop: "max_tokens", usage };
      case "pause_turn":
        return { text, toolCalls: [], stop: "pause", usage };
      case "tool_use":
        return { text, toolCalls, stop: toolCalls.length ? "tool_use" : "end", usage };
      default:
        return { text, toolCalls: [], stop: "end", usage };
    }
  }

  reset(): void {
    this.messages = [];
    this.pendingToolResults = [];
  }

  exportHistory(): unknown {
    return this.messages;
  }

  importHistory(history: unknown): void {
    if (!Array.isArray(history)) throw new Error("invalid Anthropic history");
    this.messages = history as MessageParam[];
    this.pendingToolResults = [];
  }

  historyLength(): number {
    return this.messages.length;
  }
}

/** Turns SDK errors into one readable line. */
export function describeAnthropicError(err: unknown): string | undefined {
  if (err instanceof Anthropic.AuthenticationError)
    return "Anthropic rejected the credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and retry.";
  if (err instanceof Anthropic.BadRequestError) return `Bad request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `Could not reach the Anthropic API: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`;
  return undefined;
}
