import fs from "node:fs";
import path from "node:path";
import { Checkpoints } from "./checkpoints.js";
import { Permissions, dangerReason } from "./permissions.js";
import { runShell, runJac, findJac, formatShell, formatJacResult } from "./tools/shell.js";
import { ALL_TOOLS } from "./tools/index.js";
import { toSpec, ToolError, type Todo, type Tool, type ToolContext } from "./tools/tool.js";
import { PathError } from "./paths.js";
import type { Provider, StreamEvent, ToolCall, ToolResult, ToolSpec, Usage } from "./types.js";
import type { Recorder } from "./recorder.js";
import { fillCommand, matchGlob, type EditHook } from "./plugins.js";
import { addUsage, emptyUsage } from "./types.js";

export type Answer = "yes" | "no" | "always";

export interface AgentUI {
  onEvent(e: StreamEvent): void;
  toolStart(tool: string, summary: string): void;
  toolEnd(tool: string, output: string, isError: boolean): void;
  ask(req: { tool: string; summary: string; preview?: string; danger?: string }): Promise<Answer>;
  notice(text: string): void;
  todos(list: Todo[]): void;
  turnStart(): void;
  turnEnd(): void;
}

export interface AgentOptions {
  root: string;
  provider: Provider;
  permissions: Permissions;
  ui: AgentUI;
  system: string;
  /** Shell command run after the agent changes files (e.g. `npm test`). */
  verifyCommand?: string;
  /** Run `jac check` on .jac files the agent changed. Default true. */
  autoJacCheck?: boolean;
  maxSteps?: number;
  tools?: Tool[];
  /** Records each run as a training trajectory. */
  recorder?: Recorder;
  /** Plugin hooks run after a file is written or edited. */
  editHooks?: EditHook[];
  /** Cap on each tool result sent to the model; small local models need short context. */
  maxResultChars?: number;
}

/** Model tool calls stop being useful after this many identical repeats. */
const REPEAT_LIMIT = 3;
const MAX_VERIFY_ROUNDS = 2;

export class Agent {
  readonly root: string;
  provider: Provider;
  readonly permissions: Permissions;
  readonly checkpoints = new Checkpoints();
  readonly readFiles = new Map<string, number>();
  readonly todos: Todo[] = [];
  usage: Usage = emptyUsage();
  usageByModel = new Map<string, Usage>();
  system: string;
  verifyCommand?: string;
  autoJacCheck: boolean;
  private ui: AgentUI;
  private maxSteps: number;
  private tools: Tool[];
  private specs: ToolSpec[];
  recorder?: Recorder;
  maxResultChars?: number;
  editHooks: EditHook[];

  constructor(o: AgentOptions) {
    this.root = o.root;
    this.provider = o.provider;
    this.permissions = o.permissions;
    this.ui = o.ui;
    this.system = o.system;
    this.verifyCommand = o.verifyCommand;
    this.autoJacCheck = o.autoJacCheck ?? true;
    this.maxSteps = o.maxSteps ?? 150;
    this.tools = o.tools ?? ALL_TOOLS;
    this.recorder = o.recorder;
    this.maxResultChars = o.maxResultChars;
    this.editHooks = o.editHooks ?? [];
    this.specs = this.tools.map(toSpec);
  }

  /** Runs one user request to completion. Returns the final assistant text. */
  async run(userText: string, signal: AbortSignal): Promise<string> {
    this.checkpoints.beginTurn(userText.slice(0, 60));
    this.provider.addUserText(userText);
    this.recorder?.start(this.system, this.specs, userText);
    const changed = new Set<string>();
    let lastText = "";
    let verifyRounds = 0;
    let lastCallKey = "";
    let repeats = 0;
    this.ui.turnStart();

    try {
      for (let step = 0; step < this.maxSteps; step++) {
        if (signal.aborted) break;
        const result = await this.provider.turn(this.system, this.specs, (e) => this.ui.onEvent(e), signal);
        this.track(result.usage);
        this.recorder?.assistant(result.text, result.toolCalls);
        if (result.text.trim()) lastText = result.text;

        if (result.stop === "refusal") {
          this.ui.notice(`The model declined this request${result.note ? `: ${result.note}` : "."}`);
          break;
        }
        if (result.stop === "pause") continue;

        if (result.toolCalls.length === 0) {
          if (result.stop === "max_tokens") this.ui.notice("The reply hit the output limit and was cut off.");
          // Self-verification: check what changed before handing back to the user.
          if (changed.size > 0 && verifyRounds < MAX_VERIFY_ROUNDS) {
            const failure = await this.verify(changed, signal);
            if (failure) {
              verifyRounds++;
              this.provider.addUserText(failure);
              this.recorder?.user(failure);
              continue;
            }
          }
          break;
        }

        // A tool call cut off at the output limit may parse as a valid but
        // truncated input, so none of this turn's calls run.
        if (result.stop === "max_tokens") {
          const cut = result.toolCalls.map((c) => ({
            id: c.id,
            isError: true,
            content: "Not run: your output hit the token limit mid-call. Split the work into smaller edits.",
          }));
          this.provider.addToolResults(cut);
          this.recorder?.toolResults(cut);
          continue;
        }

        const results = await this.runTools(result.toolCalls, signal, changed);

        // Detect the model looping on the same failing call.
        const key = JSON.stringify(result.toolCalls.map((c) => [c.name, c.input]));
        repeats = key === lastCallKey ? repeats + 1 : 1;
        lastCallKey = key;
        if (repeats >= REPEAT_LIMIT) {
          const last = results[results.length - 1]!;
          last.content += `\n\n[jaccode] You have made this exact call ${repeats} times in a row. Stop and try a different approach.`;
        }

        this.provider.addToolResults(results);
        this.recorder?.toolResults(results);
        if (signal.aborted) break;
        if (step === this.maxSteps - 1) this.ui.notice(`Stopped after ${this.maxSteps} steps.`);
      }
    } finally {
      this.checkpoints.endTurn();
      this.ui.turnEnd();
    }
    return lastText;
  }

  private track(u: Usage): void {
    this.usage = addUsage(this.usage, u);
    const key = `${this.provider.id}:${this.provider.model}`;
    this.usageByModel.set(key, addUsage(this.usageByModel.get(key) ?? emptyUsage(), u));
  }

  private ctx(signal: AbortSignal): ToolContext {
    return { root: this.root, checkpoints: this.checkpoints, readFiles: this.readFiles, todos: this.todos, signal };
  }

  /**
   * Runs a batch of tool calls. Consecutive read-only calls run in parallel;
   * anything that changes state runs one at a time, in order, after asking
   * permission when the mode requires it. Every call gets a result, even when
   * cancelled, so the conversation stays valid.
   */
  private async runTools(calls: ToolCall[], signal: AbortSignal, changed: Set<string>): Promise<ToolResult[]> {
    const results: ToolResult[] = new Array(calls.length);
    let i = 0;
    while (i < calls.length) {
      const tool = this.find(calls[i]!.name);
      if (tool?.kind === "read") {
        let j = i;
        while (j < calls.length && this.find(calls[j]!.name)?.kind === "read") j++;
        const batch = calls.slice(i, j);
        const out = await Promise.all(batch.map((c) => this.runOne(c, signal, changed)));
        out.forEach((r, k) => (results[i + k] = r));
        i = j;
      } else {
        results[i] = await this.runOne(calls[i]!, signal, changed);
        i++;
      }
    }
    return results;
  }

  private async runOne(call: ToolCall, signal: AbortSignal, changed: Set<string>): Promise<ToolResult> {
    if (signal.aborted) return { id: call.id, isError: true, content: "Cancelled by the user before running." };
    const tool = this.find(call.name);
    if (!tool)
      return { id: call.id, isError: true, content: `Unknown tool "${call.name}". Available: ${this.toolNames.join(", ")}.` };

    // Inputs streamed eagerly aren't validated by the API, so validate here.
    const parsed = tool.schema.safeParse(call.input);
    if (!parsed.success) {
      return {
        id: call.id,
        isError: true,
        content: JSON.stringify({
          INVALID_INPUT: parsed.error.issues.map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`),
          received: call.input,
        }).slice(0, 4000),
      };
    }
    const input = parsed.data;
    const ctx = this.ctx(signal);
    const summary = tool.summary(input);

    const command = tool.command?.(input);
    const decision = this.permissions.decide(tool.kind, tool.name, command);
    if (decision !== "allow") {
      let preview: string | undefined;
      try {
        preview = await tool.preview?.(input, ctx);
      } catch {
        preview = undefined;
      }
      const answer = await this.ui.ask({
        tool: tool.name,
        summary,
        preview,
        danger: decision === "ask-dangerous" ? dangerReason(command ?? "") : undefined,
      });
      if (answer === "no") {
        return {
          id: call.id,
          isError: true,
          content: "The user declined this action. Ask what they'd like instead, or take a different approach.",
        };
      }
      if (answer === "always" && decision === "ask") this.permissions.allowAlways(tool.name, command);
    }

    this.ui.toolStart(tool.name, summary);
    try {
      let output = await tool.run(input, ctx);
      this.ui.toolEnd(tool.name, output, false);
      if (tool.name === "todo_write") this.ui.todos(this.todos);
      if (tool.kind === "write" && typeof (input as { path?: unknown }).path === "string") {
        const abs = path.resolve(this.root, (input as { path: string }).path);
        changed.add(abs);
        output += await this.runEditHooks(abs, signal);
      }
      if (tool.name === "bash") changed.add("(shell)");
      return { id: call.id, content: this.cap(output || "(no output)") };
    } catch (err) {
      const msg =
        err instanceof ToolError || err instanceof PathError
          ? err.message
          : `Unexpected error: ${(err as Error).message ?? String(err)}`;
      this.ui.toolEnd(tool.name, msg, true);
      return { id: call.id, isError: true, content: msg };
    }
  }

  /** Runs automatic checks on what changed. Returns a message for the model if anything failed. */
  private async verify(changed: Set<string>, signal: AbortSignal): Promise<string | undefined> {
    const failures: string[] = [];
    const jacFiles = [...changed].filter((f) => f.endsWith(".jac") && fs.existsSync(f));
    if (this.autoJacCheck && jacFiles.length && findJac()) {
      for (const f of jacFiles) {
        const rel = path.relative(this.root, f);
        this.ui.toolStart("verify", `jac check ${rel}`);
        const r = await runJac(["check", f], this.root, signal);
        const out = formatJacResult(r, 180_000);
        const failed = r.code !== 0 || r.timedOut;
        this.ui.toolEnd("verify", out, failed);
        if (failed) failures.push(`$ jac check ${rel}\n${out}`);
      }
    }
    const fileChanges = [...changed].some((f) => f !== "(shell)");
    if (this.verifyCommand && fileChanges) {
      this.ui.toolStart("verify", `$ ${this.verifyCommand}`);
      const r = await runShell(this.verifyCommand, this.root, 600_000, signal);
      const out = formatShell(r, 600_000);
      const failed = r.code !== 0 || r.timedOut;
      this.ui.toolEnd("verify", out, failed);
      if (failed) failures.push(`$ ${this.verifyCommand}\n${out}`);
    }
    if (failures.length === 0) return undefined;
    return (
      "[jaccode automatic verification] These checks failed after your changes. Fix the problems, " +
      "or explain why the failure is unrelated to your change:\n\n" +
      failures.join("\n\n")
    );
  }

  /**
   * Runs plugin hooks matching an edited file (formatters, linters). Their output is appended to the tool
   * result so the model sees it; a hook that rewrites the file refreshes the read-tracking so the next
   * edit isn't refused as stale.
   */
  private async runEditHooks(abs: string, signal: AbortSignal): Promise<string> {
    const rel = path.relative(this.root, abs).split(path.sep).join("/");
    const notes: string[] = [];
    for (const h of this.editHooks.filter((h) => matchGlob(h.match, rel))) {
      const cmd = fillCommand(h.command, { file: rel });
      const timeout = (h.timeout ?? 60) * 1000;
      this.ui.toolStart("hook", `hook: ${cmd}`);
      const r = await runShell(cmd, this.root, timeout, signal);
      const out = formatShell(r, timeout);
      const failed = r.code !== 0 || r.timedOut;
      this.ui.toolEnd("hook", out, failed);
      if (failed || r.stdout.trim() || r.stderr.trim()) notes.push(`[hook ${cmd}]\n${out.slice(-2000)}`);
    }
    if (fs.existsSync(abs) && this.readFiles.has(abs)) this.readFiles.set(abs, fs.statSync(abs).mtimeMs);
    return notes.length ? `\n\n${notes.join("\n\n")}` : "";
  }

  private find(name: string): Tool | undefined {
    return this.tools.find((t) => t.name === name);
  }

  /** Keeps the head and tail of long results when a cap is set. */
  private cap(text: string): string {
    const max = this.maxResultChars;
    if (!max || text.length <= max) return text;
    const half = Math.floor(max / 2);
    return `${text.slice(0, half)}\n… [${text.length - max} characters cut; use offset/limit or a narrower search] …\n${text.slice(-half)}`;
  }

  /** Changes the tools offered to the model, e.g. a smaller set for a small local model. */
  setTools(tools: Tool[]): void {
    this.tools = tools;
    this.specs = tools.map(toSpec);
  }

  get toolNames(): string[] {
    return this.tools.map((t) => t.name);
  }

  /** Swap the model provider while keeping tools, checkpoints and permissions. */
  setProvider(p: Provider): void {
    this.provider = p;
  }

  reset(): void {
    this.provider.reset();
    this.readFiles.clear();
    this.todos.splice(0);
  }
}
