import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createTwoFilesPatch } from "diff";
import { displayPath, resolveInRoot } from "../paths.js";
import { defineTool, ToolError, type ToolContext } from "./tool.js";

const MAX_LINES = 2000;
const MAX_LINE_LEN = 2000;

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function mtime(abs: string): number {
  return fs.statSync(abs).mtimeMs;
}

/**
 * Edits must start from what the agent actually saw: the file must have been
 * read this session and must not have changed on disk since.
 */
function assertFresh(abs: string, ctx: ToolContext, rel: string): void {
  const seen = ctx.readFiles.get(abs);
  if (seen === undefined) throw new ToolError(`Read ${rel} with read_file before changing it.`);
  if (mtime(abs) !== seen)
    throw new ToolError(`${rel} changed on disk since you last read it. Read it again before editing.`);
}

function diffPreview(rel: string, before: string, after: string): string {
  const patch = createTwoFilesPatch(`a/${rel}`, `b/${rel}`, before, after, "", "", { context: 2 });
  return patch.split("\n").slice(2).join("\n").trim();
}

function countDiff(before: string, after: string): string {
  const patch = createTwoFilesPatch("a", "b", before, after, "", "", { context: 0 });
  let add = 0;
  let del = 0;
  for (const line of patch.split("\n").slice(2)) {
    if (line.startsWith("+") && !line.startsWith("+++")) add++;
    else if (line.startsWith("-") && !line.startsWith("---")) del++;
  }
  return `+${add} -${del}`;
}

export const readFile = defineTool({
  name: "read_file",
  description:
    "Read a text file. Returns lines numbered like `cat -n`. Use offset/limit for large files. " +
    "You must read a file before editing or overwriting it.",
  kind: "read",
  schema: z.object({
    path: z.string().describe("File path, relative to the project root"),
    offset: z.number().int().min(1).optional().describe("1-based line to start at"),
    limit: z.number().int().min(1).optional().describe(`Number of lines to read (default ${MAX_LINES})`),
  }),
  summary: (i) => `read ${i.path}${i.offset ? `:${i.offset}` : ""}`,
  async run(i, ctx) {
    const abs = resolveInRoot(ctx.root, i.path);
    if (!fs.existsSync(abs)) throw new ToolError(`${i.path} does not exist.`);
    if (fs.statSync(abs).isDirectory()) throw new ToolError(`${i.path} is a directory; use list_dir.`);
    const buf = fs.readFileSync(abs);
    if (isBinary(buf)) throw new ToolError(`${i.path} is a binary file (${buf.length} bytes).`);
    ctx.readFiles.set(abs, mtime(abs));
    const lines = buf.toString("utf8").split("\n");
    const start = (i.offset ?? 1) - 1;
    const limit = i.limit ?? MAX_LINES;
    const slice = lines.slice(start, start + limit);
    if (slice.length === 0) return `(${i.path} has ${lines.length} lines; nothing at offset ${i.offset})`;
    const width = String(start + slice.length).length;
    const body = slice
      .map((l, n) => {
        const text = l.length > MAX_LINE_LEN ? l.slice(0, MAX_LINE_LEN) + "… [line truncated]" : l;
        return `${String(start + n + 1).padStart(width)}\t${text}`;
      })
      .join("\n");
    const more = start + slice.length < lines.length ? `\n… ${lines.length - start - slice.length} more lines (use offset)` : "";
    return body + more;
  },
});

export const writeFile = defineTool({
  name: "write_file",
  description:
    "Create a file or overwrite one completely. Prefer edit_file for changes to existing files. " +
    "Overwriting an existing file requires reading it first.",
  kind: "write",
  schema: z.object({
    path: z.string().describe("File path, relative to the project root"),
    content: z.string().describe("The complete new file contents"),
  }),
  summary: (i) => `write ${i.path}`,
  async preview(i, ctx) {
    const abs = resolveInRoot(ctx.root, i.path);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    return diffPreview(displayPath(ctx.root, abs), before, i.content);
  },
  async run(i, ctx) {
    const abs = resolveInRoot(ctx.root, i.path);
    const rel = displayPath(ctx.root, abs);
    const exists = fs.existsSync(abs);
    if (exists) assertFresh(abs, ctx, rel);
    const before = exists ? fs.readFileSync(abs, "utf8") : "";
    ctx.checkpoints.record(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, i.content);
    ctx.readFiles.set(abs, mtime(abs));
    const lines = i.content.split("\n").length;
    return exists ? `Overwrote ${rel} (${countDiff(before, i.content)}).` : `Created ${rel} (${lines} lines).`;
  },
});

/** Finds old_string; on a miss, points at the closest line to help the model retry. */
function locate(content: string, oldStr: string, rel: string, replaceAll: boolean): number {
  const count = oldStr.length === 0 ? 0 : content.split(oldStr).length - 1;
  if (count === 0) {
    const first = oldStr.split("\n").find((l) => l.trim().length > 0)?.trim();
    let hint = "";
    if (first) {
      const lines = content.split("\n");
      const idx = lines.findIndex((l) => l.trim() === first);
      if (idx >= 0)
        hint = ` Its first line appears at line ${idx + 1} with different surrounding text or indentation; re-read that region and copy it exactly.`;
    }
    throw new ToolError(`old_string was not found in ${rel}.${hint}`);
  }
  if (count > 1 && !replaceAll)
    throw new ToolError(
      `old_string occurs ${count} times in ${rel}. Add surrounding lines to make it unique, or set replace_all.`,
    );
  return count;
}

function applyEdit(content: string, oldStr: string, newStr: string, replaceAll: boolean): string {
  return replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, () => newStr);
}

const editSchema = z.object({
  path: z.string().describe("File path, relative to the project root"),
  old_string: z.string().describe("Exact text to replace, including indentation"),
  new_string: z.string().describe("Replacement text"),
  replace_all: z.boolean().optional().describe("Replace every occurrence instead of exactly one"),
});

export const editFile = defineTool({
  name: "edit_file",
  description:
    "Replace an exact string in a file. old_string must match the file exactly (whitespace included) " +
    "and be unique unless replace_all is set. Read the file first.",
  kind: "write",
  schema: editSchema,
  summary: (i) => `edit ${i.path}`,
  async preview(i, ctx) {
    const abs = resolveInRoot(ctx.root, i.path);
    if (!fs.existsSync(abs)) return undefined;
    const before = fs.readFileSync(abs, "utf8");
    try {
      locate(before, i.old_string, i.path, !!i.replace_all);
    } catch {
      return undefined;
    }
    return diffPreview(displayPath(ctx.root, abs), before, applyEdit(before, i.old_string, i.new_string, !!i.replace_all));
  },
  async run(i, ctx) {
    const abs = resolveInRoot(ctx.root, i.path);
    const rel = displayPath(ctx.root, abs);
    if (!fs.existsSync(abs)) throw new ToolError(`${rel} does not exist. Use write_file to create it.`);
    assertFresh(abs, ctx, rel);
    if (i.old_string === i.new_string) throw new ToolError("old_string and new_string are identical.");
    const before = fs.readFileSync(abs, "utf8");
    const count = locate(before, i.old_string, rel, !!i.replace_all);
    const after = applyEdit(before, i.old_string, i.new_string, !!i.replace_all);
    ctx.checkpoints.record(abs);
    fs.writeFileSync(abs, after);
    ctx.readFiles.set(abs, mtime(abs));
    return `Edited ${rel}: ${count} replacement${count > 1 ? "s" : ""} (${countDiff(before, after)}).\n${diffPreview(rel, before, after)}`;
  },
});

export const multiEdit = defineTool({
  name: "multi_edit",
  description:
    "Apply several exact-string edits to one file in order, atomically: if any edit fails, none are applied. " +
    "Each edit sees the result of the previous one. Read the file first.",
  kind: "write",
  schema: z.object({
    path: z.string(),
    edits: z
      .array(editSchema.omit({ path: true }))
      .min(1)
      .describe("Edits applied in order"),
  }),
  summary: (i) => `edit ${i.path} (${i.edits.length} changes)`,
  async preview(i, ctx) {
    const abs = resolveInRoot(ctx.root, i.path);
    if (!fs.existsSync(abs)) return undefined;
    const before = fs.readFileSync(abs, "utf8");
    let after = before;
    try {
      for (const e of i.edits) {
        locate(after, e.old_string, i.path, !!e.replace_all);
        after = applyEdit(after, e.old_string, e.new_string, !!e.replace_all);
      }
    } catch {
      return undefined;
    }
    return diffPreview(displayPath(ctx.root, abs), before, after);
  },
  async run(i, ctx) {
    const abs = resolveInRoot(ctx.root, i.path);
    const rel = displayPath(ctx.root, abs);
    if (!fs.existsSync(abs)) throw new ToolError(`${rel} does not exist.`);
    assertFresh(abs, ctx, rel);
    const before = fs.readFileSync(abs, "utf8");
    let after = before;
    i.edits.forEach((e, n) => {
      try {
        locate(after, e.old_string, rel, !!e.replace_all);
      } catch (err) {
        throw new ToolError(`Edit ${n + 1} of ${i.edits.length} failed, nothing was changed: ${(err as Error).message}`);
      }
      after = applyEdit(after, e.old_string, e.new_string, !!e.replace_all);
    });
    ctx.checkpoints.record(abs);
    fs.writeFileSync(abs, after);
    ctx.readFiles.set(abs, mtime(abs));
    return `Applied ${i.edits.length} edits to ${rel} (${countDiff(before, after)}).\n${diffPreview(rel, before, after)}`;
  },
});

const IGNORED_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".jac", ".next", "target"]);

export const listDir = defineTool({
  name: "list_dir",
  description: "List a directory as a tree. Skips .git, node_modules, build output and virtualenvs.",
  kind: "read",
  schema: z.object({
    path: z.string().optional().describe("Directory, relative to the project root (default: root)"),
    depth: z.number().int().min(1).max(6).optional().describe("How many levels deep (default 2)"),
  }),
  summary: (i) => `list ${i.path ?? "."}`,
  async run(i, ctx) {
    const abs = resolveInRoot(ctx.root, i.path ?? ".");
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new ToolError(`${i.path} is not a directory.`);
    const out: string[] = [];
    const limit = 500;
    const walk = (dir: string, prefix: string, depth: number) => {
      if (out.length >= limit) return;
      const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => !IGNORED_DIRS.has(e.name))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const e of entries) {
        if (out.length >= limit) {
          out.push(`${prefix}… (truncated at ${limit} entries)`);
          return;
        }
        out.push(`${prefix}${e.name}${e.isDirectory() ? "/" : ""}`);
        if (e.isDirectory() && depth > 1) walk(path.join(dir, e.name), prefix + "  ", depth - 1);
      }
    };
    walk(abs, "", i.depth ?? 2);
    return out.length ? out.join("\n") : "(empty directory)";
  },
});
