import { spawn } from "node:child_process";
import { defaultShell, isWindows, killTree, which } from "../platform.js";
import { z } from "zod";
import { resolveInRoot } from "../paths.js";
import { defineTool, ToolError, truncateMiddle } from "./tool.js";
import { JAC_INSTALL } from "../jac/cheatsheet.js";
import { parseDiagnostics, summarizeDiagnostics } from "../jac/diagnostics.js";

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/** Runs a program with a timeout; the whole process tree is killed on timeout or cancel. */
export function runProcess(file: string, args: string[], cwd: string, timeoutMs: number, signal: AbortSignal): Promise<ShellResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd,
        env: { ...process.env, CI: process.env.CI ?? "1", GIT_PAGER: "cat", PAGER: "cat" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: !isWindows,
        windowsHide: true,
      });
    } catch (err) {
      resolve({ stdout: "", stderr: (err as Error).message, code: 127, timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = 4 * 1024 * 1024;
    child.stdout!.on("data", (d) => {
      if (stdout.length < cap) stdout += d;
    });
    child.stderr!.on("data", (d) => {
      if (stderr.length < cap) stderr += d;
    });
    const kill = () => killTree(child);
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const onAbort = () => kill();
    signal.addEventListener("abort", onAbort, { once: true });
    const done = (code: number | null) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, code, timedOut });
    };
    child.on("error", (err) => {
      stderr += err.message;
      done(127);
    });
    child.on("close", done);
  });
}

/** Runs a command string in the platform's shell (see defaultShell). */
export function runShell(command: string, cwd: string, timeoutMs: number, signal: AbortSignal): Promise<ShellResult> {
  const sh = defaultShell();
  return runProcess(sh.file, sh.args(command), cwd, timeoutMs, signal);
}

export function formatShell(r: ShellResult, timeoutMs: number): string {
  const parts: string[] = [];
  if (r.stdout.trim()) parts.push(r.stdout.trimEnd());
  if (r.stderr.trim()) parts.push(`[stderr]\n${r.stderr.trimEnd()}`);
  if (r.timedOut) parts.push(`[timed out after ${Math.round(timeoutMs / 1000)}s and was killed]`);
  else parts.push(`[exit code ${r.code}]`);
  return truncateMiddle(parts.join("\n"));
}

export const bash = defineTool({
  name: "bash",
  description:
    `Run a shell command in the project root (${defaultShell().name}). Use it for builds, tests, git, package managers and ` +
    "the `jac` CLI. Commands are non-interactive; output is capped and long output keeps its head and tail. " +
    "Don't use it to read or edit files: use the file tools.",
  kind: "exec",
  schema: z.object({
    command: z.string(),
    timeout_seconds: z.number().int().min(1).max(600).optional().describe("Default 120"),
    cwd: z.string().optional().describe("Working directory relative to the root"),
  }),
  summary: (i) => `$ ${i.command.length > 100 ? i.command.slice(0, 97) + "…" : i.command}`,
  command: (i) => i.command,
  async run(i, ctx) {
    const cwd = resolveInRoot(ctx.root, i.cwd ?? ".");
    const timeoutMs = (i.timeout_seconds ?? 120) * 1000;
    const r = await runShell(i.command, cwd, timeoutMs, ctx.signal);
    if (ctx.signal.aborted) throw new ToolError("Cancelled by the user.");
    return formatShell(r, timeoutMs);
  },
});

let jacPath: string | null | undefined;
export function findJac(): string | null {
  if (jacPath === undefined) {
    jacPath = which("jac");
  }
  return jacPath;
}

/** Runs `jac` directly with arguments: no shell, so no quoting differences between platforms. */
export async function runJac(args: string[], cwd: string, signal: AbortSignal, timeoutMs = 180_000): Promise<ShellResult> {
  return runProcess(findJac() ?? "jac", args, cwd, timeoutMs, signal);
}

/**
 * Formats a jac run for the model: a compact diagnostic summary with fix hints first, then the tail of the
 * raw output for context. Falls back to the raw output when nothing parses.
 */
export function formatJacResult(r: ShellResult, timeoutMs: number): string {
  const raw = formatShell(r, timeoutMs);
  const diags = parseDiagnostics(r.stdout + "\n" + r.stderr);
  if (diags.length === 0) return raw;
  const tail = raw.length > 2500 ? "…" + raw.slice(-2500) : raw;
  return `${summarizeDiagnostics(diags)}\n\nRaw output:\n${tail}`;
}

export const JAC_MISSING =
  `The \`jac\` CLI is not installed. Ask the user to install it with: ${JAC_INSTALL} ` +
  "(the pip package is outdated). Until then, review the Jac code by reading it carefully.";

export const jac = defineTool({
  name: "jac",
  description:
    "Run the Jac toolchain. `check` type-checks a file and reports errors, `run` executes it, `test` runs its " +
    "test blocks, `format` reformats it in place, `guide` prints an official Jac guide (target = guide name, " +
    "e.g. jac-types, jac-walker-patterns; target \"\" lists them). Always `check` Jac code you wrote before saying it works.",
  kind: "exec",
  schema: z.object({
    action: z.enum(["check", "run", "test", "format", "guide"]),
    target: z.string().describe("A .jac file relative to the project root, or a guide name for `guide`"),
    args: z.array(z.string()).optional().describe("Extra arguments passed to the jac command"),
  }),
  summary: (i) => `jac ${i.action} ${i.target}`.trim(),
  command: (i) => `jac ${i.action} ${i.target}${i.args?.length ? " " + i.args.join(" ") : ""}`.trim(),
  async run(i, ctx) {
    if (!findJac()) throw new ToolError(JAC_MISSING);
    const target = i.action === "guide" ? i.target.trim() : resolveInRoot(ctx.root, i.target);
    const args = [i.action, ...(target ? [target] : []), ...(i.args ?? [])];
    const r = await runJac(args, ctx.root, ctx.signal);
    return i.action === "guide" || i.action === "format" ? formatShell(r, 180_000) : formatJacResult(r, 180_000);
  },
});
