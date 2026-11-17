import { spawn, spawnSync } from "node:child_process";
import { z } from "zod";
import { resolveInRoot } from "../paths.js";
import { defineTool, ToolError, truncateMiddle } from "./tool.js";

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/** Runs a shell command with a timeout; killed if the turn is cancelled. */
export function runShell(command: string, cwd: string, timeoutMs: number, signal: AbortSignal): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env, CI: process.env.CI ?? "1", GIT_PAGER: "cat", PAGER: "cat" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = 4 * 1024 * 1024;
    child.stdout.on("data", (d) => {
      if (stdout.length < cap) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < cap) stderr += d;
    });
    const kill = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const onAbort = () => kill();
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
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
    "Run a shell command in the project root (bash -c). Use it for builds, tests, git, package managers and " +
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
    const r = spawnSync("bash", ["-c", "command -v jac"], { encoding: "utf8" });
    jacPath = r.status === 0 ? r.stdout.trim() : null;
  }
  return jacPath;
}

export const jac = defineTool({
  name: "jac",
  description:
    "Run the Jac compiler/toolchain on a file: `check` type-checks and reports errors, `run` executes it, " +
    "`test` runs its tests, `format` reformats it in place. Always `check` Jac code you wrote before saying it works.",
  kind: "exec",
  schema: z.object({
    action: z.enum(["check", "run", "test", "format"]),
    path: z.string().describe("A .jac file, relative to the project root"),
    args: z.array(z.string()).optional().describe("Extra arguments passed to the jac command"),
  }),
  summary: (i) => `jac ${i.action} ${i.path}`,
  command: (i) => `jac ${i.action} ${i.path}${i.args?.length ? " " + i.args.join(" ") : ""}`,
  async run(i, ctx) {
    if (!findJac())
      throw new ToolError(
        "The `jac` CLI is not installed. Ask the user to run `pip install jaclang` (or `pip install jaseci`), " +
          "then try again. Until then, review the Jac code by reading it carefully.",
      );
    const file = resolveInRoot(ctx.root, i.path);
    const quoted = [i.action, file, ...(i.args ?? [])].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
    const r = await runShell(`jac ${quoted}`, ctx.root, 180_000, ctx.signal);
    return formatShell(r, 180_000);
  },
});
