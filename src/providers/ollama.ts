import type {
  Effort,
  Provider,
  StreamEvent,
  ToolResult,
  ToolSpec,
  TurnResult,
} from "../types.js";
import { emptyUsage } from "../types.js";

/** Message shape of Ollama's native /api/chat endpoint. */
interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

interface OllamaChunk {
  message?: OllamaMessage;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export interface OllamaOptions {
  model: string;
  host?: string;
  effort: Effort;
  numCtx?: number;
}

/**
 * Local models through Ollama: no API key, nothing leaves the machine.
 * Uses the native /api/chat endpoint with tool calling and NDJSON streaming.
 */
export class OllamaProvider implements Provider {
  readonly id = "ollama";
  model: string;
  effort: Effort;
  private host: string;
  private numCtx: number;
  private messages: OllamaMessage[] = [];
  private callNames = new Map<string, string>();
  private counter = 0;
  private pulled = new Set<string>();

  constructor(opts: OllamaOptions) {
    this.model = opts.model;
    this.effort = opts.effort;
    this.host = (opts.host ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
    if (!/^https?:\/\//.test(this.host)) this.host = `http://${this.host}`;
    this.numCtx = opts.numCtx ?? 32768;
  }

  addUserText(text: string): void {
    this.messages.push({ role: "user", content: text });
  }

  addToolResults(results: ToolResult[]): void {
    for (const r of results) {
      this.messages.push({
        role: "tool",
        tool_name: this.callNames.get(r.id) ?? "tool",
        content: r.isError ? `ERROR: ${r.content}` : r.content,
      });
    }
  }

  async turn(
    system: string,
    tools: ToolSpec[],
    onEvent: (e: StreamEvent) => void,
    signal: AbortSignal,
  ): Promise<TurnResult> {
    const body = {
      model: this.model,
      stream: true,
      messages: [{ role: "system", content: system }, ...this.messages],
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      options: { num_ctx: this.numCtx },
    };

    const post = async () => {
      try {
        return await fetch(`${this.host}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw err;
        throw new Error(
          `Could not reach Ollama at ${this.host}. Install it from https://ollama.com and start it with \`ollama serve\`.`,
        );
      }
    };
    let res = await post();
    if (res.status === 404 && !this.pulled.has(this.model)) {
      // The model isn't downloaded yet: fetch it once, then retry.
      const detail = await res.text().catch(() => "");
      if (!/not found/i.test(detail)) throw new Error(`Ollama returned 404: ${detail}`);
      await this.pull(onEvent, signal);
      res = await post();
    }
    if (!res.ok || !res.body) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text().catch(() => "")}`);
    }

    let text = "";
    let thinking = "";
    const calls: { function: { name: string; arguments: Record<string, unknown> } }[] = [];
    const usage = emptyUsage();
    let doneReason = "";

    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const data = JSON.parse(line) as OllamaChunk;
        if (data.error) throw new Error(`Ollama: ${data.error}`);
        const m = data.message;
        if (m?.content) {
          text += m.content;
          onEvent({ type: "text", text: m.content });
        }
        if (m?.thinking) {
          thinking += m.thinking;
          onEvent({ type: "thinking", text: m.thinking });
        }
        for (const c of m?.tool_calls ?? []) {
          calls.push(c);
          onEvent({ type: "tool_start", name: c.function.name });
        }
        if (data.done) {
          doneReason = data.done_reason ?? "";
          usage.inputTokens = data.prompt_eval_count ?? 0;
          usage.outputTokens = data.eval_count ?? 0;
        }
      }
    }

    this.messages.push({
      role: "assistant",
      content: text,
      ...(thinking ? { thinking } : {}),
      ...(calls.length ? { tool_calls: calls } : {}),
    });

    const toolCalls = calls.map((c) => {
      const id = `ollama_${++this.counter}`;
      this.callNames.set(id, c.function.name);
      let input: unknown = c.function.arguments;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          /* left as a string; schema validation reports it */
        }
      }
      return { id, name: c.function.name, input };
    });

    if (toolCalls.length) return { text, toolCalls, stop: "tool_use", usage };
    if (doneReason === "length") return { text, toolCalls: [], stop: "max_tokens", usage };
    return { text, toolCalls: [], stop: "end", usage };
  }

  /** Downloads the model through Ollama, reporting progress every 10%. */
  private async pull(onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<void> {
    onEvent({ type: "notice", text: `downloading ${this.model} (first use only)…` });
    const res = await fetch(`${this.host}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`Could not download ${this.model}: ${await res.text().catch(() => res.status)}`);
    const decoder = new TextDecoder();
    let buf = "";
    let lastPct = -10;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const d = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
        if (d.error) throw new Error(`Could not download ${this.model}: ${d.error}`);
        if (d.total && d.completed) {
          const pct = Math.floor((d.completed / d.total) * 100);
          if (pct >= lastPct + 10) {
            lastPct = pct - (pct % 10);
            onEvent({ type: "notice", text: `downloading ${this.model}: ${pct}% of ${(d.total / 1e9).toFixed(1)} GB` });
          }
        }
      }
    }
    this.pulled.add(this.model);
    onEvent({ type: "notice", text: `${this.model} ready` });
  }

  reset(): void {
    this.messages = [];
    this.callNames.clear();
  }

  exportHistory(): unknown {
    return this.messages;
  }

  importHistory(history: unknown): void {
    if (!Array.isArray(history)) throw new Error("invalid Ollama history");
    this.messages = history as OllamaMessage[];
  }

  historyLength(): number {
    return this.messages.length;
  }
}
