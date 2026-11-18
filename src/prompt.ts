import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findJac } from "./tools/shell.js";
import { JAC_CHEATSHEET, JAC_INSTALL, JAC_TARGET_VERSION } from "./jac/cheatsheet.js";

/** Files read as project memory, in order. JAC.md is ours; the others are common conventions. */
export const MEMORY_FILES = ["JAC.md", "AGENTS.md", "CLAUDE.md"];

export function globalDir(): string {
  return process.env.JACCODE_HOME ?? path.join(os.homedir(), ".jaccode");
}



function gitInfo(root: string): string | undefined {
  const r = spawnSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  if (r.status !== 0) return undefined;
  const s = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
  const dirty = s.stdout.trim().split("\n").filter(Boolean).length;
  return `git branch ${r.stdout.trim()}, ${dirty} uncommitted change${dirty === 1 ? "" : "s"} at session start`;
}

function jacVersion(): string | undefined {
  if (!findJac()) return undefined;
  const r = spawnSync("jac", ["--version"], { encoding: "utf8", timeout: 10_000 });
  return (r.stdout || r.stderr).trim().split("\n")[0] || "installed";
}

function topLevel(root: string): string {
  try {
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .slice(0, 60)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return entries.join("  ");
  } catch {
    return "";
  }
}

function countJacFiles(root: string, limit = 2000): number {
  let n = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || n > limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__pycache__") continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
      else if (e.name.endsWith(".jac")) n++;
    }
  };
  walk(root, 0);
  return n;
}

export function loadMemory(root: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const global = path.join(globalDir(), "JAC.md");
  if (fs.existsSync(global)) out.push({ file: "~/.jaccode/JAC.md (personal)", text: fs.readFileSync(global, "utf8") });
  for (const name of MEMORY_FILES) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) out.push({ file: name, text: fs.readFileSync(p, "utf8").slice(0, 40_000) });
  }
  return out;
}

export interface PromptInfo {
  jacFiles: number;
  jacVersion?: string;
  memoryFiles: string[];
}

/**
 * Builds the system prompt. It stays byte-stable for the whole session (no
 * timestamps finer than the date), so prompt caching keeps working.
 */
/** Short working rules for small local models: fewer words, one action at a time. */
const LITE_RULES = `# How to work
- Look before you change: outline or grep to find code, read_file before editing a file.
- Change code with edit_file (exact text from the file) or write_file for new files.
- After changing Jac code, run the jac tool with action "check" and fix every error it reports.
- If a tool fails, read the error and try something different. Never repeat a failed call unchanged.
- When done, reply with one or two sentences: what changed and whether the check passed.`;

export interface PromptOptions {
  /** Compact prompt for small local models. */
  lite?: boolean;
}

export function buildSystemPrompt(root: string, opts: PromptOptions = {}): { prompt: string; info: PromptInfo } {
  const jacFiles = countJacFiles(root);
  const version = jacVersion();
  const memory = loadMemory(root);
  const git = gitInfo(root);

  const sections = [
    `You are jaccode, a coding agent working in the user's terminal on the project at ${root}. You read, ` +
      `write and run code through your tools. You are an expert in Jac and Python, and competent in every ` +
      `mainstream language.`,
    opts.lite
      ? LITE_RULES
      : `# How to work
- Understand before changing: get the shape of the code with outline, find things with grep and glob, then
  read_file the parts you need. Read every file before you edit it.
- For work with three or more steps, keep a checklist with todo_write and update it as you go.
- Make the smallest change that fully solves the task, in the style of the surrounding code. Prefer edit_file
  or multi_edit over rewriting whole files.
- Verify: run the relevant build, tests or \`jac check\` after changing code, and fix what fails. Never claim
  something works without having run it; if you couldn't verify, say so.
- Call independent read-only tools in parallel when you can.
- When a tool fails, read the error and change approach; don't repeat the same call.
- Never run destructive commands (deleting data, force pushing, resetting git) unless the user asked.
- Ask the user only when blocked on a decision that is genuinely theirs; otherwise pick a sensible default
  and mention it.
- Finish with a short summary: what changed (files), how you verified it, and anything left undone.
  Keep replies concise; the user reads them in a terminal.`,
    `# Environment
- Platform: ${process.platform} (${os.release()}), shell: bash, date: ${new Date().toISOString().slice(0, 10)}
- Project root: ${root}${git ? `\n- ${git}` : ""}
- Jac toolchain: ${version ?? `not installed; if the user needs to run Jac, suggest: ${JAC_INSTALL}`}${version && !version.includes(JAC_TARGET_VERSION) ? ` (notes below target ${JAC_TARGET_VERSION}; follow the installed compiler where they differ)` : ""}
- .jac files in project: ${jacFiles}
- Top level: ${topLevel(root)}`,
    JAC_CHEATSHEET,
  ];

  if (memory.length) {
    sections.push(
      "# Project memory\nInstructions and notes the user keeps for this project. Follow them.\n\n" +
        memory
          .map((m) => `<memory file="${m.file}">\n${(opts.lite ? m.text.slice(0, 4000) : m.text).trim()}\n</memory>`)
          .join("\n\n"),
    );
  }

  return {
    prompt: sections.join("\n\n"),
    info: { jacFiles, jacVersion: version, memoryFiles: memory.map((m) => m.file) },
  };
}

export const INIT_PROMPT = `Explore this project and write a JAC.md file at the root that will help you work here in future
sessions. Include: what the project is, how it's laid out, how to build, run and test it (exact commands),
coding conventions you can see in the code, and anything surprising. Keep it under 80 lines and only
include facts you verified by reading files. If JAC.md already exists, improve it instead of replacing it.`;
