#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { Agent } from "./agent.js";
import { DEFAULT_MODELS, EFFORTS, MODES, loadConfig, type Config } from "./config.js";
import { estimateCost, knownModels } from "./cost.js";
import { Permissions } from "./permissions.js";
import { buildSystemPrompt, INIT_PROMPT, type PromptInfo } from "./prompt.js";
import { resolveInRoot } from "./paths.js";
import { AnthropicProvider, describeAnthropicError } from "./providers/anthropic.js";
import { OllamaProvider } from "./providers/ollama.js";
import { listSessions, loadSession, newSessionId, saveSession } from "./session.js";
import { runShell, formatShell } from "./tools/shell.js";
import { PrintUI, TerminalUI, colorDiff, renderTodos } from "./ui.js";
import { LineReader } from "./lines.js";
import type { Effort, PermissionMode, Provider } from "./types.js";

const VERSION = "0.1.0";

const HELP = `${pc.bold("jaccode")} — a terminal coding agent with first-class Jac support

${pc.bold("Usage")}
  jaccode                       start an interactive session in the current directory
  jaccode "fix the failing test" start with a first request
  jaccode -p "explain src/app.jac" answer once and exit (pipe-friendly)
  cat error.log | jaccode -p "why does this fail?"

${pc.bold("Options")}
  -p, --print <prompt>     non-interactive: run one request, print the answer, exit
  -m, --model <id>         model id (default ${DEFAULT_MODELS.anthropic}; ollama: ${DEFAULT_MODELS.ollama})
      --provider <name>    anthropic | ollama (local models, no API key)
  -e, --effort <level>     ${EFFORTS.join(" | ")} (default high)
      --mode <mode>        ask | auto-edit | auto (default auto-edit)
      --yolo               same as --mode auto (dangerous commands still ask)
      --verify <command>   run this after the agent changes files, e.g. "npm test"
      --no-thinking        hide the model's reasoning summary
      --no-jac-check       don't auto-run \`jac check\` on changed .jac files
  -r, --resume [id]        resume the latest session here, or a given session id
  -C, --cwd <dir>          project root (default: current directory)
  -q, --quiet              with -p: print only the answer
  -v, --version
  -h, --help

${pc.bold("Credentials")}
  Anthropic: ANTHROPIC_API_KEY, or a profile from \`ant auth login\`.
  Ollama:    run \`ollama serve\`; set OLLAMA_HOST if it isn't on localhost:11434.
`;

const SLASH_HELP = `${pc.bold("Commands")}
  /help                 this list
  /model [id]           show or switch model (e.g. /model claude-sonnet-5-5, /model ollama:qwen3-coder)
  /effort [level]       show or set reasoning effort: ${EFFORTS.join(", ")}
  /mode [mode]          show or set permissions: ask, auto-edit, auto
  /undo                 revert the files changed by the last request
  /diff                 show every change made this session
  /plan                 show the current checklist
  /verify [cmd|off]     set a command to run after each change (e.g. npm test)
  /cost                 token usage and estimated cost
  /init                 explore the project and write JAC.md (project memory)
  /remember <note>      add a note to JAC.md
  /clear                start a fresh conversation (files are kept)
  /sessions             list saved sessions for this project
  /resume <id>          load a saved session
  /exit                 quit (also Ctrl+D)

${pc.bold("Input")}
  @path/to/file         attach a file's contents to your message
  !command              run a shell command yourself; its output is added to your next message
  line ending in \\       continue on the next line
  Ctrl+C                cancel the running request (twice at the prompt to quit)
`;

interface Flags {
  print?: string;
  model?: string;
  provider?: string;
  effort?: string;
  mode?: string;
  yolo?: boolean;
  verify?: string;
  "no-thinking"?: boolean;
  "no-jac-check"?: boolean;
  resume?: string | boolean;
  cwd?: string;
  quiet?: boolean;
  version?: boolean;
  help?: boolean;
}

function parse(): { flags: Flags; positional: string[] } {
  // --resume takes an optional value: treat a following non-flag as its id.
  const argv = process.argv.slice(2);
  const idx = argv.findIndex((a) => a === "--resume" || a === "-r");
  let resume: string | boolean | undefined;
  if (idx >= 0) {
    const next = argv[idx + 1];
    if (next && !next.startsWith("-") && /^\d{14}-/.test(next)) {
      resume = next;
      argv.splice(idx, 2);
    } else {
      resume = true;
      argv.splice(idx, 1);
    }
  }
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      print: { type: "string", short: "p" },
      model: { type: "string", short: "m" },
      provider: { type: "string" },
      effort: { type: "string", short: "e" },
      mode: { type: "string" },
      yolo: { type: "boolean" },
      verify: { type: "string" },
      "no-thinking": { type: "boolean" },
      "no-jac-check": { type: "boolean" },
      cwd: { type: "string", short: "C" },
      quiet: { type: "boolean", short: "q" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
  return { flags: { ...(values as Flags), resume }, positional: positionals };
}

function makeProvider(cfg: Pick<Config, "provider" | "model" | "effort" | "showThinking" | "ollamaHost">): Provider {
  if (cfg.provider === "ollama") return new OllamaProvider({ model: cfg.model, effort: cfg.effort, host: cfg.ollamaHost });
  return new AnthropicProvider({ model: cfg.model, effort: cfg.effort, showThinking: cfg.showThinking });
}

/** Expands @file mentions into attached file contents, and marks those files as read. */
function expandMentions(text: string, agent: Agent): string {
  const attached: string[] = [];
  const re = /(^|\s)@([\w./\-]+[\w/\-])/g;
  for (const m of text.matchAll(re)) {
    const rel = m[2]!;
    let abs: string;
    try {
      abs = resolveInRoot(agent.root, rel);
    } catch {
      continue;
    }
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
    const buf = fs.readFileSync(abs);
    if (buf.length > 200_000 || buf.subarray(0, 8000).includes(0)) continue;
    agent.readFiles.set(abs, fs.statSync(abs).mtimeMs);
    attached.push(`<file path="${rel}">\n${buf.toString("utf8")}\n</file>`);
  }
  return attached.length ? `${text}\n\n${attached.join("\n\n")}` : text;
}

function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function costReport(agent: Agent): string {
  const lines: string[] = [];
  let total = 0;
  let unknown = false;
  for (const [key, u] of agent.usageByModel) {
    const c = estimateCost(key, u);
    if (c === undefined) unknown = true;
    else total += c;
    lines.push(
      `  ${key}: ${formatTokens(u.inputTokens)} in, ${formatTokens(u.cacheReadTokens)} cached, ` +
        `${formatTokens(u.cacheWriteTokens)} cache-write, ${formatTokens(u.outputTokens)} out` +
        (c === undefined ? " (price unknown)" : ` ≈ $${c.toFixed(4)}`),
    );
  }
  if (lines.length === 0) return pc.dim("  no requests yet");
  lines.push(pc.bold(`  total ≈ $${total.toFixed(4)}${unknown ? " + unknown" : ""}`));
  return lines.join("\n");
}

function banner(cfg: Config, info: PromptInfo, root: string): string {
  const where = cfg.provider === "ollama" ? `ollama:${cfg.model}` : cfg.model;
  const parts = [
    `${pc.bold(pc.magenta("◆ jaccode"))} ${pc.dim("v" + VERSION)}  ${pc.dim(where)} · effort ${cfg.effort} · ${cfg.mode}`,
    pc.dim(`  ${root}`),
  ];
  const facts: string[] = [];
  if (info.jacFiles) facts.push(`${info.jacFiles} .jac files`);
  facts.push(info.jacVersion ? `jac ${info.jacVersion}` : "jac not installed");
  if (info.memoryFiles.length) facts.push(`memory: ${info.memoryFiles.join(", ")}`);
  else facts.push("no JAC.md yet (try /init)");
  parts.push(pc.dim(`  ${facts.join(" · ")}`));
  parts.push(pc.dim("  /help for commands, Ctrl+C to cancel, Ctrl+D to quit"));
  return parts.join("\n");
}

async function main(): Promise<void> {
  const { flags, positional } = parse();
  if (flags.help) return void process.stdout.write(HELP);
  if (flags.version) return void process.stdout.write(VERSION + "\n");

  const root = fs.realpathSync(path.resolve(flags.cwd ?? process.cwd()));
  let model = flags.model;
  let provider = flags.provider as Config["provider"] | undefined;
  if (model?.startsWith("ollama:")) {
    provider = "ollama";
    model = model.slice("ollama:".length);
  }
  const cfg = loadConfig(root, {
    model,
    provider,
    effort: flags.effort as Effort | undefined,
    mode: (flags.yolo ? "auto" : flags.mode) as PermissionMode | undefined,
    verifyCommand: flags.verify,
    showThinking: flags["no-thinking"] ? false : undefined,
    autoJacCheck: flags["no-jac-check"] ? false : undefined,
  });

  const { prompt: system, info } = buildSystemPrompt(root);
  const printMode = flags.print !== undefined;
  const ui = printMode ? new PrintUI(!!flags.quiet) : new TerminalUI();
  const agent = new Agent({
    root,
    provider: makeProvider(cfg),
    permissions: new Permissions(cfg.mode),
    ui,
    system,
    verifyCommand: cfg.verifyCommand,
    autoJacCheck: cfg.autoJacCheck,
  });

  let sessionId = newSessionId();
  let title = "";
  let created = new Date().toISOString();
  if (flags.resume) {
    const s = loadSession(flags.resume, root);
    if (!s) throw new Error("No saved session found to resume.");
    if (s.provider !== agent.provider.id) {
      agent.setProvider(makeProvider({ ...cfg, provider: s.provider as Config["provider"], model: s.model }));
    }
    agent.provider.model = s.model;
    agent.provider.importHistory(s.history);
    sessionId = s.id;
    title = s.title;
    created = s.created;
  }

  const persist = () => {
    if (agent.provider.historyLength() === 0) return;
    try {
      const now = new Date().toISOString();
      saveSession({
        id: sessionId,
        root,
        provider: agent.provider.id,
        model: agent.provider.model,
        created,
        updated: now,
        title,
        history: agent.provider.exportHistory(),
      });
    } catch {
      /* saving is best-effort */
    }
  };

  const runRequest = async (text: string, controller: AbortController) => {
    if (!title) title = text.split("\n")[0]!.slice(0, 80);
    try {
      return await agent.run(text, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        ui.notice("Cancelled.");
        return "";
      }
      const msg = describeAnthropicError(err) ?? (err as Error).message ?? String(err);
      ui.notice(pc.red(msg));
      if (printMode) process.exitCode = 1;
      return "";
    } finally {
      persist();
    }
  };

  // ---- non-interactive ----
  if (printMode) {
    let text = flags.print || positional.join(" ");
    if (!process.stdin.isTTY) {
      const piped = fs.readFileSync(0, "utf8");
      if (piped.trim()) text = `${text}\n\n<stdin>\n${piped}\n</stdin>`;
    }
    if (!text.trim()) throw new Error("-p needs a prompt");
    const controller = new AbortController();
    process.on("SIGINT", () => controller.abort());
    await runRequest(expandMentions(text, agent), controller);
    return;
  }

  // ---- interactive ----
  const tui = ui as TerminalUI;
  const lines = new LineReader(process.stdin, process.stdout, process.stdin.isTTY ?? false);
  tui.lines = lines;
  console.log(banner(cfg, info, root));
  if (flags.resume) console.log(pc.dim(`  resumed session ${sessionId}: ${title}`));
  console.log();

  let current: AbortController | null = null;
  let lastSigint = 0;
  lines.rl.on("SIGINT", () => {
    if (current) {
      current.abort();
      return;
    }
    const now = Date.now();
    if (now - lastSigint < 1500) {
      lines.close();
      return;
    }
    lastSigint = now;
    process.stdout.write(pc.dim("\n(press Ctrl+C again to quit)\n"));
    lines.clearLine();
  });

  let shellContext = "";
  let pending = positional.join(" ").trim();

  const readInput = async (): Promise<string | null> => {
    const parts: string[] = [];
    for (;;) {
      const line = await lines.ask(parts.length ? pc.dim("… ") : pc.magenta("› "));
      if (line === null) return parts.length ? parts.join("\n") : null;
      if (line.endsWith("\\")) {
        parts.push(line.slice(0, -1));
        continue;
      }
      parts.push(line);
      return parts.join("\n");
    }
  };

  for (;;) {
    const input = pending || (await readInput());
    pending = "";
    if (input === null) break;
    const text = input.trim();
    if (!text) continue;

    if (text.startsWith("!")) {
      const cmd = text.slice(1).trim();
      const r = await runShell(cmd, root, 600_000, new AbortController().signal);
      const out = formatShell(r, 600_000);
      console.log(pc.dim(out));
      shellContext += `<shell command="${cmd}">\n${out}\n</shell>\n`;
      continue;
    }

    if (text.startsWith("/")) {
      const [cmd, ...rest] = text.slice(1).split(/\s+/);
      const arg = rest.join(" ").trim();
      const handled = await slash(cmd!, arg);
      if (handled === "exit") break;
      if (typeof handled === "string" && handled) pending = handled;
      continue;
    }

    if (!title) title = text.split("\n")[0]!.slice(0, 80);
    const message = expandMentions(shellContext ? `${shellContext}\n${text}` : text, agent);
    shellContext = "";
    current = new AbortController();
    await runRequest(message, current);
    current = null;
    console.log();
  }

  lines.close();
  persist();
  if (agent.checkpoints.changedFiles().length) {
    console.log(pc.dim(`Changed ${agent.checkpoints.changedFiles().length} file(s) this session.`));
  }
  console.log(pc.dim(`Session saved: jaccode --resume ${sessionId}`));
  process.exit(0);

  /** Handles a slash command. Returns "exit", or a prompt to send to the agent. */
  async function slash(cmd: string, arg: string): Promise<string | void> {
    switch (cmd) {
      case "help":
      case "?":
        return void console.log(SLASH_HELP);
      case "exit":
      case "quit":
      case "q":
        return "exit";
      case "model": {
        if (!arg) {
          console.log(`  ${agent.provider.id}:${agent.provider.model}`);
          console.log(pc.dim(`  known: ${knownModels().join(", ")}, or ollama:<model>`));
          return;
        }
        const toOllama = arg.startsWith("ollama:");
        const nextProvider = toOllama ? "ollama" : "anthropic";
        const nextModel = toOllama ? arg.slice(7) : arg;
        if (nextProvider !== agent.provider.id) {
          const p = makeProvider({ ...cfg, provider: nextProvider, model: nextModel, effort: agent.provider.effort });
          agent.setProvider(p);
          console.log(pc.dim(`  switched to ${nextProvider}:${nextModel} (new conversation; files and checkpoints kept)`));
        } else {
          agent.provider.model = nextModel;
          console.log(pc.dim(`  model: ${nextModel}`));
        }
        return;
      }
      case "effort":
        if (!arg) return void console.log(`  effort: ${agent.provider.effort}`);
        if (!EFFORTS.includes(arg as Effort)) return void console.log(pc.red(`  use one of: ${EFFORTS.join(", ")}`));
        agent.provider.effort = arg as Effort;
        return void console.log(pc.dim(`  effort: ${arg}`));
      case "mode":
        if (!arg) return void console.log(`  mode: ${agent.permissions.mode}`);
        if (!MODES.includes(arg as PermissionMode)) return void console.log(pc.red(`  use one of: ${MODES.join(", ")}`));
        agent.permissions.mode = arg as PermissionMode;
        return void console.log(pc.dim(`  mode: ${arg}`));
      case "undo": {
        const r = agent.checkpoints.undo();
        if (!r) return void console.log(pc.dim("  nothing to undo"));
        for (const f of r.files) agent.readFiles.delete(f);
        console.log(pc.green(`  reverted ${r.files.length} file(s) from "${r.label}":`));
        for (const f of r.files) console.log(pc.dim(`    ${path.relative(root, f)}`));
        agent.provider.addUserText(
          `[jaccode] The user undid your last changes to: ${r.files.map((f) => path.relative(root, f)).join(", ")}. ` +
            `Those files are back to their earlier contents; re-read them before editing again.`,
        );
        return;
      }
      case "diff": {
        const d = agent.checkpoints.sessionDiff(root);
        return void console.log(d ? colorDiff(d, 400) : pc.dim("  no changes this session"));
      }
      case "plan":
      case "todos":
        return void console.log(renderTodos(agent.todos));
      case "verify":
        if (!arg) return void console.log(`  verify: ${agent.verifyCommand ?? "off"}`);
        agent.verifyCommand = arg === "off" ? undefined : arg;
        return void console.log(pc.dim(`  verify: ${agent.verifyCommand ?? "off"}`));
      case "cost":
        return void console.log(costReport(agent));
      case "init":
        return INIT_PROMPT;
      case "remember": {
        if (!arg) return void console.log(pc.red("  usage: /remember <note>"));
        const file = path.join(root, "JAC.md");
        const prefix = fs.existsSync(file) ? (fs.readFileSync(file, "utf8").endsWith("\n") ? "" : "\n") : "# Project notes\n\n";
        fs.appendFileSync(file, `${prefix}- ${arg}\n`);
        agent.system = buildSystemPrompt(root).prompt;
        return void console.log(pc.dim("  saved to JAC.md"));
      }
      case "clear":
        persist();
        agent.reset();
        agent.system = buildSystemPrompt(root).prompt;
        sessionId = newSessionId();
        title = "";
        created = new Date().toISOString();
        return void console.log(pc.dim("  started a fresh conversation"));
      case "sessions": {
        const list = listSessions(root).slice(0, 15);
        if (!list.length) return void console.log(pc.dim("  no saved sessions for this project"));
        for (const s of list) console.log(`  ${pc.cyan(s.id)}  ${pc.dim(s.model)}  ${s.title}`);
        return;
      }
      case "resume": {
        const s = loadSession(arg || true, root);
        if (!s) return void console.log(pc.red("  session not found"));
        persist();
        if (s.provider !== agent.provider.id) {
          agent.setProvider(makeProvider({ ...cfg, provider: s.provider as Config["provider"], model: s.model }));
        }
        agent.reset();
        agent.provider.model = s.model;
        agent.provider.importHistory(s.history);
        sessionId = s.id;
        title = s.title;
        created = s.created;
        return void console.log(pc.dim(`  resumed ${s.id}: ${s.title}`));
      }
      default:
        console.log(pc.red(`  unknown command /${cmd}; try /help`));
    }
  }
}

main().catch((err) => {
  process.stderr.write(pc.red(`jaccode: ${(err as Error).message ?? err}\n`));
  process.exit(1);
});

