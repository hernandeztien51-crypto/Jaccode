import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { Agent, type AgentUI } from "./agent.js";
import { Permissions } from "./permissions.js";
import { buildSystemPrompt } from "./prompt.js";
import { findJac, runJac } from "./tools/shell.js";
import { JAC_INSTALL } from "./jac/cheatsheet.js";
import { parseDiagnostics } from "./jac/diagnostics.js";
import { LITE_TOOLS } from "./tools/index.js";
import type { Provider, Usage } from "./types.js";
import type { Recorder } from "./recorder.js";

/**
 * A Jac benchmark graded by the real compiler. Each task folder holds:
 *   task.md            the request given to the agent
 *   reference.jac      a known-good solution (used by --reference to validate the task), or
 *   reference/         a known-good set of files, for multi-file tasks
 *   solution.test.jac  hidden tests, an annex of solution.jac, added only after the agent finishes
 *   setup/             optional starting files
 */
export interface EvalTask {
  id: string;
  dir: string;
  prompt: string;
}

export interface EvalResult {
  id: string;
  /** `jac check solution.jac` passed (parses and type-checks). */
  compiles: boolean;
  /** Every hidden test passed. */
  passed: boolean;
  /** Lines that look like Python or JS instead of Jac. */
  foreignSyntax: number;
  /** Error codes `jac check` reported for the final solution. */
  errorCodes: string[];
  toolCalls: number;
  toolErrors: number;
  seconds: number;
  usage?: Usage;
  error?: string;
  checkOutput?: string;
  testOutput?: string;
}

export function loadTasks(dir: string, only?: string[]): EvalTask[] {
  if (!fs.existsSync(dir)) throw new Error(`No eval tasks at ${dir}`);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "task.md")))
    .filter((e) => !only?.length || only.includes(e.name))
    .map((e) => ({
      id: e.name,
      dir: path.join(dir, e.name),
      prompt: fs.readFileSync(path.join(dir, e.name, "task.md"), "utf8").trim(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const FOREIGN = [
  /^\s*(def|if|elif|else|for|while|class|try|except|with)\b[^{};]*:\s*$/, // Python block header
  /&&|\|\|/, // C-style boolean operators
  /(^|[^\w.])(true|false|null)\b/, // lowercase literals
  /import:py\b/,
  /^\s*import from [^{]+\{[^}]*\}\s*;/, // brace import with a semicolon
  /\bpass;?\s*$/,
];

export function countForeignSyntax(source: string): number {
  return source.split("\n").filter((line) => {
    const code = line.replace(/#.*$/, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    return FOREIGN.some((re) => re.test(code));
  }).length;
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/** Grades a workspace: compile, then run the hidden tests. */
export async function grade(task: EvalTask, work: string, signal: AbortSignal): Promise<Omit<EvalResult, "id" | "toolCalls" | "toolErrors" | "seconds">> {
  const solution = path.join(work, "solution.jac");
  if (!fs.existsSync(solution)) {
    return { compiles: false, passed: false, foreignSyntax: 0, errorCodes: [], error: "solution.jac was not created" };
  }
  const foreignSyntax = countForeignSyntax(fs.readFileSync(solution, "utf8"));
  const check = await runJac(["check", "solution.jac"], work, signal, 180_000);
  const compiles = check.code === 0 && !check.timedOut;
  fs.copyFileSync(path.join(task.dir, "solution.test.jac"), path.join(work, "solution.test.jac"));
  const test = compiles ? await runJac(["test", "solution.jac"], work, signal, 300_000) : undefined;
  return {
    compiles,
    passed: compiles && test?.code === 0 && !test.timedOut,
    foreignSyntax,
    errorCodes: [...new Set(parseDiagnostics(check.stdout + "\n" + check.stderr).filter((d) => d.severity === "error").map((d) => d.code))],
    checkOutput: (check.stdout + check.stderr).slice(-3000),
    testOutput: test ? (test.stdout + test.stderr).slice(-3000) : undefined,
  };
}

/** A UI that stays quiet and counts tool activity. */
class CountingUI implements AgentUI {
  toolCalls = 0;
  toolErrors = 0;
  constructor(private verbose: boolean) {}
  onEvent(): void {}
  toolStart(_t: string, summary: string): void {
    this.toolCalls++;
    if (this.verbose) process.stderr.write(pc.dim(`    ● ${summary}\n`));
  }
  toolEnd(_t: string, _o: string, isError: boolean): void {
    if (isError) this.toolErrors++;
  }
  async ask(): Promise<"no"> {
    return "no";
  }
  notice(text: string): void {
    if (this.verbose) process.stderr.write(pc.yellow(`    ℹ ${text}\n`));
  }
  todos(): void {}
  turnStart(): void {}
  turnEnd(): void {}
}

export interface EvalOptions {
  tasksDir: string;
  only?: string[];
  /** Run at most this many tasks (after --only). */
  limit?: number;
  /** Grade the reference solutions instead of running a model (validates the suite). */
  reference?: boolean;
  makeProvider: () => Provider;
  timeoutMs?: number;
  verbose?: boolean;
  recorder?: Recorder;
  /** Small-model mode: compact prompt, core tools, short tool output. */
  lite?: boolean;
}

export async function runEval(opts: EvalOptions): Promise<EvalResult[]> {
  if (!findJac()) throw new Error(`the Jac compiler is needed to grade the benchmark. Install it with:\n  ${JAC_INSTALL}`);
  const all = loadTasks(opts.tasksDir, opts.only);
  const tasks = opts.limit ? all.slice(0, opts.limit) : all;
  const results: EvalResult[] = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jaccode-eval-"));

  for (const task of tasks) {
    const work = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, `${task.id}-`)));
    const setup = path.join(task.dir, "setup");
    if (fs.existsSync(setup)) copyDir(setup, work);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 600_000);
    process.stderr.write(`${pc.bold(task.id)}\n`);

    const ui = new CountingUI(!!opts.verbose);
    let usage: Usage | undefined;
    let error: string | undefined;
    try {
      if (opts.reference) {
        const refDir = path.join(task.dir, "reference");
        if (fs.existsSync(refDir)) copyDir(refDir, work);
        else fs.copyFileSync(path.join(task.dir, "reference.jac"), path.join(work, "solution.jac"));
      } else {
        const agent = new Agent({
          root: work,
          provider: opts.makeProvider(),
          permissions: new Permissions("auto"),
          ui,
          system: buildSystemPrompt(work, { lite: opts.lite }).prompt,
          autoJacCheck: true,
          tools: opts.lite ? LITE_TOOLS : undefined,
          maxResultChars: opts.lite ? 6000 : undefined,
          recorder: opts.recorder,
        });
        await agent.run(task.prompt, controller.signal);
        usage = agent.usage;
      }
    } catch (err) {
      error = controller.signal.aborted ? "timed out" : (err as Error).message;
    } finally {
      clearTimeout(timer);
    }

    const graded = await grade(task, work, new AbortController().signal);
    const r: EvalResult = {
      id: task.id,
      ...graded,
      error: error ?? graded.error,
      toolCalls: ui.toolCalls,
      toolErrors: ui.toolErrors,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      usage,
    };
    results.push(r);
    if (!opts.reference) opts.recorder?.commit({ source: "eval", task: task.id, passed: r.passed, compiles: r.compiles });
    const mark = r.passed ? pc.green("pass") : r.compiles ? pc.yellow("compiles, tests fail") : pc.red("does not compile");
    process.stderr.write(`  ${mark}${r.error ? pc.dim(` (${r.error})`) : ""} ${pc.dim(`${r.seconds}s, ${r.toolCalls} tool calls`)}\n`);
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  return results;
}

export function summarize(results: EvalResult[]): string {
  const n = results.length || 1;
  const pct = (k: number) => `${((k / n) * 100).toFixed(1)}%`;
  const passed = results.filter((r) => r.passed).length;
  const compiles = results.filter((r) => r.compiles).length;
  const foreign = results.filter((r) => r.foreignSyntax > 0).length;
  const calls = results.reduce((a, r) => a + r.toolCalls, 0);
  const errors = results.reduce((a, r) => a + r.toolErrors, 0);
  const secs = results.reduce((a, r) => a + r.seconds, 0);
  return [
    pc.bold(`Jac eval: ${results.length} tasks`),
    `  pass@1          ${pct(passed)} (${passed}/${results.length})`,
    `  compiles        ${pct(compiles)}`,
    `  foreign syntax  ${pct(foreign)} of solutions`,
    `  tool calls      ${calls} (${errors} errors, ${calls ? ((errors / calls) * 100).toFixed(1) : "0"}%)`,
    `  time            ${secs.toFixed(0)}s total, ${(secs / n).toFixed(1)}s per task`,
    `  top errors      ${topCodes(results) || "none"}`,
    `  failed          ${results.filter((r) => !r.passed).map((r) => r.id).join(", ") || "none"}`,
  ].join("\n");
}

function topCodes(results: EvalResult[]): string {
  const counts = new Map<string, number>();
  for (const r of results) for (const c of r.errorCodes) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c, n]) => `${c}×${n}`)
    .join(", ");
}
