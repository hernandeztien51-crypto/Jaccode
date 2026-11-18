import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { z } from "zod";
import { displayPath, resolveInRoot } from "../paths.js";
import { defineTool, ToolError } from "./tool.js";

type Rule = { re: RegExp; label: (m: RegExpExecArray) => string };

const JAC: Rule[] = [
  { re: /^(\s*)(?:override\s+)?(obj|node|edge|walker|class|enum)\s+(\w+)(\([^)]*\))?/, label: (m) => `${m[2]} ${m[3]}${m[4] ?? ""}` },
  { re: /^(\s*)(?:override\s+)?(?:static\s+)?(?:async\s+)?def(?::\w+)?\s+(\w+)\s*(\([^)]*\))?\s*(->\s*[^{;]+)?/, label: (m) => `def ${m[2]}${m[3] ?? "()"}${m[4] ? " " + m[4].trim() : ""}` },
  { re: /^(\s*)(?:override\s+)?can\s+(\w+)\s+with\s+([^{]+?)\s*\{/, label: (m) => `can ${m[2]} with ${m[3]}` },
  { re: /^(\s*)impl\s+([\w.]+)/, label: (m) => `impl ${m[2]}` },
  { re: /^(\s*)glob\s+(\w+)/, label: (m) => `glob ${m[2]}` },
  { re: /^(\s*)test\s+("[^"]*"|\w+)/, label: (m) => `test ${m[2]}` },
  { re: /^(\s*)with\s+entry(:\w+)?/, label: (m) => `with entry${m[2] ?? ""}` },
];

const PY: Rule[] = [
  { re: /^(\s*)class\s+(\w+)(\([^)]*\))?/, label: (m) => `class ${m[2]}${m[3] ?? ""}` },
  { re: /^(\s*)(?:async\s+)?def\s+(\w+)\s*(\([^)]*\))?\s*(->\s*[^:]+)?/, label: (m) => `def ${m[2]}${m[3] ?? "()"}${m[4] ? " " + m[4].trim() : ""}` },
];

const TS: Rule[] = [
  { re: /^(\s*)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/, label: (m) => `class ${m[2]}` },
  { re: /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)\s*(\([^)]*\))?/, label: (m) => `function ${m[2]}${m[3] ?? "()"}` },
  { re: /^(\s*)(?:export\s+)?(?:interface|type)\s+(\w+)/, label: (m) => `type ${m[2]}` },
  { re: /^(\s*)(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/, label: (m) => `const ${m[2]} =>` },
  { re: /^(\s+)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/, label: (m) => `${m[2]}()` },
];

const BY_EXT: Record<string, Rule[]> = {
  ".jac": JAC,
  ".py": PY,
  ".ts": TS,
  ".tsx": TS,
  ".js": TS,
  ".jsx": TS,
  ".mjs": TS,
};

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "constructor"]);

/** Declarations in one file, indented by nesting, with line numbers. */
export function outlineFile(source: string, ext: string): string[] {
  const rules = BY_EXT[ext];
  if (!rules) return [];
  const out: string[] = [];
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(#|\/\/)/.test(line)) return;
    for (const r of rules) {
      const m = r.re.exec(line);
      if (!m) continue;
      const label = r.label(m).replace(/\s+/g, " ").trim();
      if (KEYWORDS.has(label.replace(/\(\)$/, ""))) return;
      const depth = Math.min(4, Math.floor((m[1] ?? "").replace(/\t/g, "    ").length / 4));
      out.push(`${String(i + 1).padStart(5)}  ${"  ".repeat(depth)}${label}`);
      return;
    }
  });
  return out;
}

const IGNORE = ["**/node_modules/**", "**/.git/**", "**/__pycache__/**", "**/.venv/**", "**/dist/**", "**/build/**", "**/.jac/**"];

export const outline = defineTool({
  name: "outline",
  description:
    "List the declarations (functions, objects, nodes, edges, walkers, abilities, classes, tests) in a file or " +
    "directory with line numbers. Use it to understand a codebase before reading whole files. Supports .jac, .py, .ts and .js.",
  kind: "read",
  schema: z.object({
    path: z.string().optional().describe("File or directory, relative to the project root (default: root)"),
  }),
  summary: (i) => `outline ${i.path ?? "."}`,
  async run(i, ctx) {
    const abs = resolveInRoot(ctx.root, i.path ?? ".");
    if (!fs.existsSync(abs)) throw new ToolError(`${i.path} does not exist.`);
    const files = fs.statSync(abs).isFile()
      ? [abs]
      : (await fg(`**/*{${Object.keys(BY_EXT).join(",")}}`, { cwd: abs, ignore: IGNORE, absolute: true, onlyFiles: true })).sort();
    const sections: string[] = [];
    let total = 0;
    const lineBudget = 600;
    for (const f of files) {
      let src: string;
      try {
        src = fs.readFileSync(f, "utf8");
      } catch {
        continue;
      }
      if (src.length > 1_000_000) continue;
      const items = outlineFile(src, path.extname(f));
      if (!items.length) continue;
      if (total + items.length > lineBudget) {
        sections.push(`… stopped after ${sections.length} files (${files.length} total); outline a subdirectory for more`);
        break;
      }
      total += items.length;
      sections.push(`${displayPath(ctx.root, f)}\n${items.join("\n")}`);
    }
    return sections.length ? sections.join("\n\n") : "No declarations found.";
  },
});
