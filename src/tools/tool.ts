import { z } from "zod";
import type { Checkpoints } from "../checkpoints.js";
import type { ToolKind } from "../permissions.js";
import type { ToolSpec } from "../types.js";

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface ToolContext {
  root: string;
  checkpoints: Checkpoints;
  /** mtime of each file when the agent last read or wrote it. */
  readFiles: Map<string, number>;
  todos: Todo[];
  signal: AbortSignal;
}

export class ToolError extends Error {}

export interface Tool<I = any> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  kind: ToolKind;
  /** One-line summary shown in the transcript, e.g. `edit src/app.ts`. */
  summary(input: I): string;
  /** For exec tools: the shell command, used by the permission rules. */
  command?(input: I): string;
  /** Optional preview (e.g. a diff) shown before asking for permission. */
  preview?(input: I, ctx: ToolContext): Promise<string | undefined>;
  run(input: I, ctx: ToolContext): Promise<string>;
}

export function defineTool<I>(t: Tool<I>): Tool<I> {
  return t;
}

/** JSON Schema for the API, generated from the Zod schema (one source of truth). */
export function toSpec(tool: Tool): ToolSpec {
  const schema = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, inputSchema: clean(schema) as Record<string, unknown> };
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema") continue;
      if ((k === "minimum" || k === "maximum") && Math.abs(v as number) === Number.MAX_SAFE_INTEGER) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return node;
}

/** Keeps the head and tail of long output so errors at the end aren't lost. */
export function truncateMiddle(text: string, max = 30000): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  const dropped = text.length - max;
  return `${text.slice(0, half)}\n\n… [${dropped} characters omitted] …\n\n${text.slice(-half)}`;
}
