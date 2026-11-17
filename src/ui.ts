import pc from "picocolors";
import type { LineReader } from "./lines.js";
import type { AgentUI, Answer } from "./agent.js";
import type { Todo } from "./tools/tool.js";
import type { StreamEvent } from "./types.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function colorDiff(diff: string, maxLines = 40): string {
  const lines = diff.split("\n").filter((l) => !l.startsWith("===") && !l.startsWith("---") && !l.startsWith("+++"));
  const shown = lines.slice(0, maxLines).map((l) => {
    if (l.startsWith("+")) return pc.green(l);
    if (l.startsWith("-")) return pc.red(l);
    if (l.startsWith("@@")) return pc.cyan(l);
    return pc.dim(l);
  });
  if (lines.length > maxLines) shown.push(pc.dim(`… ${lines.length - maxLines} more lines`));
  return shown.join("\n");
}

function indent(text: string, prefix = "    "): string {
  return text
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}

export function renderTodos(list: Todo[]): string {
  if (list.length === 0) return pc.dim("  (no plan)");
  return list
    .map((t) => {
      if (t.status === "completed") return pc.dim(`  ☑ ${pc.strikethrough(t.content)}`);
      if (t.status === "in_progress") return pc.yellow(`  ▸ ${t.content}`);
      return `  ☐ ${t.content}`;
    })
    .join("\n");
}

/** Summarizes a tool's output in a few lines for the transcript. */
function summarizeOutput(tool: string, output: string): string {
  const lines = output.split("\n");
  switch (tool) {
    case "read_file":
      return pc.dim(`${lines.length} lines`);
    case "glob":
    case "grep":
    case "list_dir":
      return pc.dim(output.startsWith("No ") ? output : `${lines.length} result${lines.length === 1 ? "" : "s"}`);
    case "edit_file":
    case "multi_edit":
      return [pc.dim(lines[0] ?? ""), colorDiff(lines.slice(1).join("\n"), 30)].filter(Boolean).join("\n");
    case "write_file":
    case "todo_write":
      return pc.dim(lines[0] ?? "");
    default: {
      const tail = lines.filter((l) => l.trim()).slice(-8);
      const hidden = lines.filter((l) => l.trim()).length - tail.length;
      return pc.dim((hidden > 0 ? `… ${hidden} lines above\n` : "") + tail.join("\n"));
    }
  }
}

/**
 * Interactive terminal UI. Text streams to stdout as it's generated; tool
 * activity is shown compactly with diffs for edits.
 */
export class TerminalUI implements AgentUI {
  private atLineStart = true;
  private inThinking = false;
  private spinner?: NodeJS.Timeout;
  private spinnerFrame = 0;
  private out = process.stdout;
  lines?: LineReader;


  private write(s: string): void {
    this.stopSpinner();
    this.out.write(s);
    if (s.length) this.atLineStart = s.endsWith("\n");
  }

  private newline(): void {
    if (!this.atLineStart) this.write("\n");
  }

  startSpinner(label = "thinking"): void {
    if (!this.out.isTTY || this.spinner) return;
    this.spinner = setInterval(() => {
      const f = FRAMES[this.spinnerFrame++ % FRAMES.length];
      this.out.write(`\r${pc.magenta(f!)} ${pc.dim(label + "…")}  `);
    }, 80);
  }

  stopSpinner(): void {
    if (!this.spinner) return;
    clearInterval(this.spinner);
    this.spinner = undefined;
    this.out.write("\r\x1b[2K");
  }

  onEvent(e: StreamEvent): void {
    switch (e.type) {
      case "thinking":
        if (!this.inThinking) {
          this.newline();
          this.write(pc.dim(pc.italic("✻ ")));
          this.inThinking = true;
        }
        this.write(pc.dim(pc.italic(e.text)));
        break;
      case "text":
        if (this.inThinking) {
          this.write("\n\n");
          this.inThinking = false;
        }
        this.write(e.text);
        break;
      case "tool_start":
        this.inThinking = false;
        break;
      case "notice":
        this.notice(e.text);
        break;
    }
  }

  toolStart(tool: string, summary: string): void {
    this.inThinking = false;
    this.newline();
    const color = tool === "verify" ? pc.yellow : pc.cyan;
    this.write(`${color("●")} ${pc.bold(summary)}\n`);
    this.startSpinner("running");
  }

  toolEnd(tool: string, output: string, isError: boolean): void {
    this.stopSpinner();
    const body = isError ? pc.red(output.split("\n").slice(0, 12).join("\n")) : summarizeOutput(tool, output);
    if (body.trim()) this.write(indent(body, "  ⎿ ").replace(/\n {2}⎿ /g, "\n    ") + "\n");
    this.startSpinner();
  }

  async ask(req: { tool: string; summary: string; preview?: string; danger?: string }): Promise<Answer> {
    this.stopSpinner();
    this.newline();
    if (!this.lines) {
      this.write(pc.yellow(`⚠ needs permission, skipped in non-interactive mode: ${req.summary}\n`));
      return "no";
    }
    this.write(`${pc.yellow("?")} ${pc.bold(req.summary)}\n`);
    if (req.preview) this.write(indent(colorDiff(req.preview, 60)) + "\n");
    if (req.danger) this.write(pc.red(`  ⚠ ${req.danger}\n`));
    const opts = req.danger ? "[y]es / [n]o" : "[y]es / [a]lways this session / [n]o";
    for (;;) {
      const line = await this.lines.ask(pc.yellow(`  Allow? ${opts} › `));
      this.atLineStart = true;
      if (line === null) return "no";
      const a = line.trim().toLowerCase();
      if (a === "y" || a === "yes" || a === "") return "yes";
      if (a === "n" || a === "no") return "no";
      if (!req.danger && (a === "a" || a === "always")) return "always";
    }
  }

  notice(text: string): void {
    this.stopSpinner();
    this.newline();
    this.write(pc.yellow(`ℹ ${text}\n`));
  }

  todos(list: Todo[]): void {
    this.stopSpinner();
    this.newline();
    this.write(renderTodos(list) + "\n");
    this.startSpinner();
  }

  turnStart(): void {
    this.atLineStart = true;
    this.inThinking = false;
    this.startSpinner();
  }

  turnEnd(): void {
    this.stopSpinner();
    this.newline();
  }

  print(s: string): void {
    this.newline();
    this.write(s.endsWith("\n") ? s : s + "\n");
  }
}

/**
 * Non-interactive UI for `-p`: the answer goes to stdout so it can be piped,
 * progress goes to stderr.
 */
export class PrintUI implements AgentUI {
  constructor(private quiet: boolean) {}
  private err(s: string) {
    if (!this.quiet) process.stderr.write(s);
  }
  onEvent(e: StreamEvent): void {
    if (e.type === "text") process.stdout.write(e.text);
    else if (e.type === "notice") this.err(pc.yellow(`ℹ ${e.text}\n`));
  }
  toolStart(_tool: string, summary: string): void {
    this.err(pc.dim(`\n● ${summary}\n`));
  }
  toolEnd(_tool: string, output: string, isError: boolean): void {
    if (isError) this.err(pc.red(`  ⎿ ${output.split("\n")[0]}\n`));
  }
  async ask(req: { summary: string }): Promise<Answer> {
    this.err(pc.yellow(`⚠ skipped (needs permission; rerun with --mode auto-edit or --yolo): ${req.summary}\n`));
    return "no";
  }
  notice(text: string): void {
    this.err(pc.yellow(`ℹ ${text}\n`));
  }
  todos(): void {}
  turnStart(): void {}
  turnEnd(): void {
    process.stdout.write("\n");
  }
}
