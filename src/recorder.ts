import fs from "node:fs";
import path from "node:path";
import type { ToolCall, ToolResult, ToolSpec } from "./types.js";

/** One message in the OpenAI-style chat format that TRL, Unsloth and most SFT tools read. */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export interface Trajectory {
  messages: ChatMessage[];
  tools: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  meta: Record<string, unknown>;
}

/**
 * Records agent runs as training trajectories (JSONL, one run per line).
 * Runs are held until `commit`, so a caller can attach a verdict first
 * (e.g. the eval runner marks whether the hidden tests passed) and keep
 * only verified runs.
 */
export class Recorder {
  private current?: Trajectory;
  private names = new Map<string, string>();

  constructor(readonly file: string) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  start(system: string, tools: ToolSpec[], userText: string): void {
    this.names.clear();
    this.current = {
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      meta: {},
    };
  }

  user(text: string): void {
    this.current?.messages.push({ role: "user", content: text });
  }

  assistant(text: string, calls: ToolCall[]): void {
    if (!this.current) return;
    for (const c of calls) this.names.set(c.id, c.name);
    this.current.messages.push({
      role: "assistant",
      content: text,
      ...(calls.length
        ? {
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: JSON.stringify(c.input) },
            })),
          }
        : {}),
    });
  }

  toolResults(results: ToolResult[]): void {
    if (!this.current) return;
    for (const r of results) {
      this.current.messages.push({
        role: "tool",
        tool_call_id: r.id,
        name: this.names.get(r.id) ?? "tool",
        content: r.isError ? `ERROR: ${r.content}` : r.content,
      });
    }
  }

  /** Writes the current run with `meta` attached. Returns false if there was nothing to write. */
  commit(meta: Record<string, unknown> = {}): boolean {
    if (!this.current) return false;
    this.current.meta = { ...this.current.meta, ...meta, recorded: new Date().toISOString() };
    fs.appendFileSync(this.file, JSON.stringify(this.current) + "\n");
    this.current = undefined;
    return true;
  }

  discard(): void {
    this.current = undefined;
  }
}
