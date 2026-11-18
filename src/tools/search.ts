import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import fg from "fast-glob";
import { z } from "zod";
import { displayPath, resolveInRoot } from "../paths.js";
import { defineTool, ToolError, truncateMiddle } from "./tool.js";

const IGNORE = ["**/.git/**", "**/node_modules/**", "**/__pycache__/**", "**/.venv/**", "**/venv/**", "**/dist/**", "**/.jac/**"];

let rgAvailable: boolean | undefined;
function hasRipgrep(): boolean {
  if (rgAvailable === undefined) rgAvailable = spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0;
  return rgAvailable;
}

export const glob = defineTool({
  name: "glob",
  description: "Find files by glob pattern (e.g. `**/*.jac`, `src/**/*.ts`). Newest files first.",
  kind: "read",
  schema: z.object({
    pattern: z.string(),
    path: z.string().optional().describe("Directory to search in (default: root)"),
  }),
  summary: (i) => `glob ${i.pattern}`,
  async run(i, ctx) {
    const cwd = resolveInRoot(ctx.root, i.path ?? ".");
    const files = await fg(i.pattern, { cwd, ignore: IGNORE, dot: true, onlyFiles: true, absolute: true, stats: true });
    files.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
    const limit = 200;
    const lines = files.slice(0, limit).map((f) => displayPath(ctx.root, f.path));
    if (files.length > limit) lines.push(`… ${files.length - limit} more`);
    return lines.length ? lines.join("\n") : "No files matched.";
  },
});

export const grep = defineTool({
  name: "grep",
  description:
    "Search file contents with a regular expression (ripgrep syntax). Returns `file:line:text`. " +
    "Use `glob` to filter files, e.g. `*.jac`.",
  kind: "read",
  schema: z.object({
    pattern: z.string().describe("Regular expression"),
    path: z.string().optional().describe("File or directory to search (default: root)"),
    glob: z.string().optional().describe("Only search files matching this glob"),
    ignore_case: z.boolean().optional(),
    context: z.number().int().min(0).max(10).optional().describe("Lines of context around each match"),
    max_results: z.number().int().min(1).max(1000).optional().describe("Default 200"),
  }),
  summary: (i) => `grep ${JSON.stringify(i.pattern)}${i.glob ? ` in ${i.glob}` : ""}`,
  async run(i, ctx) {
    const target = resolveInRoot(ctx.root, i.path ?? ".");
    const root = fs.realpathSync(ctx.root);
    // Search from the project root with a relative target so results come back project-relative on every OS
    // (Windows temp folders have a short and a long name, so stripping an absolute prefix is unreliable).
    const relTarget = path.relative(root, target);
    const max = i.max_results ?? 200;
    let output: string;
    if (hasRipgrep()) {
      const args = ["--line-number", "--no-heading", "--color=never", "--max-columns=400"];
      if (i.ignore_case) args.push("-i");
      if (i.context) args.push("-C", String(i.context));
      if (i.glob) args.push("--glob", i.glob);
      for (const g of IGNORE) args.push("--glob", `!${g.replace(/^\*\*\//, "").replace(/\/\*\*$/, "")}`);
      args.push("--", i.pattern);
      args.push(relTarget || ".");
      const res = spawnSync("rg", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      if (res.status === 2) throw new ToolError(res.stderr.trim() || "ripgrep failed");
      output = res.stdout;
    } else {
      output = jsGrep(target, root, i.pattern, !!i.ignore_case, i.glob);
    }
    const lines = output
      .split("\n")
      .filter(Boolean)
      .map((l) => (path.sep === "\\" ? l.replace(/^[^:]+/, (p) => p.replace(/\\/g, "/")) : l))
      .map((l) => l.replace(/^\.\//, ""));
    if (lines.length === 0) return "No matches.";
    const shown = lines.slice(0, max);
    if (lines.length > max) shown.push(`… ${lines.length - max} more matches (narrow the search)`);
    return truncateMiddle(shown.join("\n"));
  },
});

/** Fallback when ripgrep isn't installed. */
function jsGrep(target: string, root: string, pattern: string, ignoreCase: boolean, globPat?: string): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern, ignoreCase ? "i" : "");
  } catch (e) {
    throw new ToolError(`Invalid regular expression: ${(e as Error).message}`);
  }
  const files = fs.statSync(target).isFile()
    ? [target]
    : fg.sync(globPat ? `**/${globPat}` : "**/*", { cwd: target, ignore: IGNORE, absolute: true, onlyFiles: true });
  const out: string[] = [];
  for (const f of files) {
    let text: string;
    try {
      const buf = fs.readFileSync(f);
      if (buf.subarray(0, 8000).includes(0)) continue;
      text = buf.toString("utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, n) => {
      if (re.test(line)) out.push(`${path.relative(root, f)}:${n + 1}:${line.slice(0, 400)}`);
    });
    if (out.length > 5000) break;
  }
  return out.join("\n");
}
