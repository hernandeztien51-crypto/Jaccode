import { z } from "zod";
import { editFile, listDir, multiEdit, readFile, writeFile } from "./files.js";
import { glob, grep } from "./search.js";
import { bash, jac } from "./shell.js";
import { outline } from "./outline.js";
import { defineTool, type Tool } from "./tool.js";

export const todoWrite = defineTool({
  name: "todo_write",
  description:
    "Keep a visible checklist for multi-step work. Send the whole list each time. Keep exactly one item " +
    "in_progress while working, and mark items completed as soon as they're done.",
  kind: "read",
  schema: z.object({
    todos: z.array(
      z.object({
        content: z.string(),
        status: z.enum(["pending", "in_progress", "completed"]),
      }),
    ),
  }),
  summary: (i) => `plan (${i.todos.filter((t) => t.status === "completed").length}/${i.todos.length} done)`,
  async run(i, ctx) {
    ctx.todos.splice(0, ctx.todos.length, ...i.todos);
    return "Plan updated.";
  },
});

export const ALL_TOOLS: Tool[] = [readFile, writeFile, editFile, multiEdit, listDir, glob, grep, outline, bash, jac, todoWrite];

/** Core tools for small local models: fewer choices, simpler arguments. */
export const LITE_TOOLS: Tool[] = [readFile, writeFile, editFile, grep, outline, bash, jac];

export function toolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}
