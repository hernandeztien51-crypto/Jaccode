import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defaultShell } from "./platform.js";
import { globalDir } from "./prompt.js";
import { formatShell, runShell } from "./tools/shell.js";
import { defineTool, ToolError, type Tool } from "./tools/tool.js";

/**
 * Plugins extend jaccode without code changes. Each is a folder with a plugin.json:
 *
 * {
 *   "name": "git",
 *   "description": "Commit and review helpers",
 *   "enabled": true,                       // bundled plugins can default to off
 *   "prompt": "prompt.md",                 // guidance added to the system prompt
 *   "commands": { "review": { "description": "...", "prompt": "Review ... $ARGS" } },
 *   "tools": [{ "name": "...", "description": "...", "parameters": { JSON Schema },
 *               "command": "npm run lint -- {{path}}", "readOnly": false, "timeout": 120 }],
 *   "hooks": { "afterEdit": [{ "match": "*.jac", "command": "jac format {{file}}" }] }
 * }
 *
 * Search order (later wins on name clashes): bundled plugins, ~/.jaccode/plugins, <project>/.jaccode/plugins.
 */

export interface PluginCommand {
  description: string;
  prompt: string;
}

export interface EditHook {
  match: string;
  command: string;
  timeout?: number;
}

export interface Plugin {
  name: string;
  description: string;
  source: "bundled" | "user" | "project";
  dir: string;
  enabled: boolean;
  prompt?: string;
  commands: Record<string, PluginCommand>;
  tools: Tool[];
  afterEdit: EditHook[];
}

const ManifestTool = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "tool names are lowercase snake_case"),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  command: z.string(),
  readOnly: z.boolean().optional(),
  timeout: z.number().int().min(1).max(3600).optional(),
});

const Manifest = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  description: z.string().default(""),
  enabled: z.boolean().default(true),
  prompt: z.string().optional(),
  commands: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.object({ description: z.string(), prompt: z.string() })).default({}),
  tools: z.array(ManifestTool).default([]),
  hooks: z
    .object({ afterEdit: z.array(z.object({ match: z.string(), command: z.string(), timeout: z.number().optional() })).default([]) })
    .default({ afterEdit: [] }),
});

export function bundledPluginDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins");
}

/** Quotes a value for the shell commands run in, so arguments can't inject extra commands. */
export function quoteArg(value: string, shellName = defaultShell().name): string {
  if (shellName === "powershell" || shellName === "pwsh") return `'${value.replace(/'/g, "''")}'`;
  if (shellName === "cmd") return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Fills {{name}} placeholders with quoted values; missing optional values become empty. */
export function fillCommand(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = values[key];
    if (v === undefined || v === null) return "";
    return quoteArg(typeof v === "string" ? v : JSON.stringify(v));
  });
}

function toolFromManifest(plugin: string, t: z.infer<typeof ManifestTool>, root: string): Tool {
  const params = t.parameters ?? { type: "object", properties: {} };
  let schema: z.ZodType;
  try {
    schema = z.fromJSONSchema(params as Parameters<typeof z.fromJSONSchema>[0]);
  } catch (err) {
    throw new Error(`plugin ${plugin}: tool ${t.name} has an invalid parameters schema: ${(err as Error).message}`);
  }
  return defineTool({
    name: t.name,
    description: `${t.description} (plugin: ${plugin})`,
    kind: t.readOnly ? "read" : "exec",
    schema: schema as z.ZodType<Record<string, unknown>>,
    summary: (i) => `${t.name} ${Object.values(i ?? {}).map(String).join(" ")}`.trim(),
    command: (i) => fillCommand(t.command, i ?? {}),
    async run(i, ctx) {
      const timeoutMs = (t.timeout ?? 120) * 1000;
      const r = await runShell(fillCommand(t.command, i ?? {}), root, timeoutMs, ctx.signal);
      if (ctx.signal.aborted) throw new ToolError("Cancelled by the user.");
      return formatShell(r, timeoutMs);
    },
  });
}

function loadDir(base: string, source: Plugin["source"], root: string, errors: string[]): Plugin[] {
  if (!fs.existsSync(base)) return [];
  const out: Plugin[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    const file = path.join(dir, "plugin.json");
    if (!fs.existsSync(file)) continue;
    try {
      const m = Manifest.parse(JSON.parse(fs.readFileSync(file, "utf8")));
      const prompt = m.prompt ? fs.readFileSync(path.join(dir, m.prompt), "utf8").trim() : undefined;
      out.push({
        name: m.name,
        description: m.description,
        source,
        dir,
        enabled: m.enabled,
        prompt,
        commands: m.commands,
        tools: m.tools.map((t) => toolFromManifest(m.name, t, root)),
        afterEdit: m.hooks.afterEdit,
      });
    } catch (err) {
      errors.push(`${path.relative(process.cwd(), file) || file}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  return out;
}

export interface PluginSettings {
  /** Turn on plugins that default to off. */
  enable?: string[];
  /** Turn off plugins. */
  disable?: string[];
}

export function loadPlugins(root: string, settings: PluginSettings = {}): { plugins: Plugin[]; errors: string[] } {
  const errors: string[] = [];
  const byName = new Map<string, Plugin>();
  for (const [dir, source] of [
    [bundledPluginDir(), "bundled"],
    [path.join(globalDir(), "plugins"), "user"],
    [path.join(root, ".jaccode", "plugins"), "project"],
  ] as const) {
    for (const p of loadDir(dir, source, root, errors)) byName.set(p.name, p);
  }
  for (const p of byName.values()) {
    if (settings.enable?.includes(p.name)) p.enabled = true;
    if (settings.disable?.includes(p.name)) p.enabled = false;
  }
  return { plugins: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), errors };
}

/** Matches a simple glob like `*.jac`, `src/**\/*.ts` against a forward-slash relative path. */
export function matchGlob(glob: string, rel: string): boolean {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?");
  const target = glob.includes("/") ? rel : rel.split("/").pop()!;
  return new RegExp(`^${re}$`).test(target);
}

export function pluginPrompt(plugins: Plugin[]): string {
  const active = plugins.filter((p) => p.enabled && p.prompt);
  if (!active.length) return "";
  return "# Plugin guidance\n\n" + active.map((p) => `## ${p.name}\n${p.prompt}`).join("\n\n");
}

/** Expands a plugin command's prompt template. */
export function expandCommand(cmd: PluginCommand, args: string): string {
  return cmd.prompt.replace(/\$ARGS/g, args.trim() || "(no arguments given)");
}
