import type { PermissionMode } from "./types.js";

export type ToolKind = "read" | "write" | "exec";

export type Decision = "allow" | "ask" | "ask-dangerous";

/** Commands that only read state and are safe to run without asking. */
const SAFE_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "wc", "pwd", "echo", "which", "whoami", "date", "file",
  "stat", "tree", "find", "grep", "rg", "fd", "du", "df", "env", "printenv", "uname",
  "sort", "uniq", "cut", "diff", "basename", "dirname", "realpath", "true",
]);

/** Read-only Windows commands; PowerShell names are case-insensitive. */
const SAFE_WINDOWS = new Set(["dir", "type", "where", "get-childitem", "get-content", "select-string", "get-location", "get-command", "findstr"]);

const SAFE_GIT = new Set(["status", "diff", "log", "show", "branch", "remote", "blame", "ls-files", "rev-parse"]);

const SAFE_VERSION_TOOLS = new Set(["node", "npm", "python", "python3", "pip", "jac", "tsc", "cargo", "go"]);

/** Patterns that always need a person's yes, in every mode. */
const DANGEROUS: { re: RegExp; why: string }[] = [
  { re: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*\s+)*(-[a-zA-Z]*\s+)*(\/|~|\$HOME|\*)(\s|$)/, why: "recursive delete of a broad path" },
  { re: /\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]/, why: "forced recursive delete" },
  { re: /\bsudo\b/, why: "runs as root" },
  { re: /\b(mkfs|fdisk|parted)\b|\bdd\s+.*of=\/dev\//, why: "writes to a disk device" },
  { re: /\b(curl|wget)\b[^|]*\|\s*(ba|z|)sh\b/, why: "pipes a download into a shell" },
  { re: /\bgit\s+push\b.*(--force|-f\b)/, why: "force push" },
  { re: /\bgit\s+reset\s+--hard\b/, why: "discards uncommitted work" },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, why: "deletes untracked files" },
  { re: /\bchmod\s+(-R\s+)?777\b/, why: "makes files world-writable" },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/, why: "stops the machine" },
  { re: /:\(\)\s*\{\s*:\|:&\s*\};:/, why: "fork bomb" },
  { re: />\s*\/dev\/sd[a-z]/, why: "overwrites a disk device" },
  { re: /\bnpm\s+publish\b|\bgit\s+push\b/, why: "publishes outside this machine" },
  // Windows (PowerShell / cmd)
  { re: /\bRemove-Item\b[^|;]*-Recurse/i, why: "recursive delete" },
  { re: /\b(rd|rmdir)\s+\/s\b|\bdel\s+[^|;]*\/[sq]\b/i, why: "recursive or silent delete" },
  { re: /\bformat(\.com)?\s+[a-z]:/i, why: "formats a drive" },
  { re: /\b(diskpart|bcdedit)\b|\breg(\.exe)?\s+delete\b/i, why: "changes disks or the registry" },
  { re: /\b(Stop|Restart)-Computer\b/i, why: "stops the machine" },
  { re: /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(iex|Invoke-Expression)\b/i, why: "runs a downloaded script" },
];

export function dangerReason(command: string): string | undefined {
  return DANGEROUS.find((d) => d.re.test(command))?.why;
}

/** True when every part of a command only reads state. */
export function isReadOnlyCommand(command: string): boolean {
  if (/[`]|\$\(|>|<\(|\btee\b/.test(command)) return false;
  const segments = command.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((seg) => {
    const words = seg.split(/\s+/);
    const cmd = words[0]!;
    if (cmd === "git") return SAFE_GIT.has(words[1] ?? "");
    if (cmd === "jac") return ["check", "guide", "--version", "--help"].includes(words[1] ?? "");
    if (cmd === "find") return !words.some((w) => w === "-delete" || w === "-exec" || w === "-execdir");
    if (SAFE_VERSION_TOOLS.has(cmd)) return words.length === 2 && /^(--version|-v|-V|version)$/.test(words[1]!);
    return SAFE_COMMANDS.has(cmd) || SAFE_WINDOWS.has(cmd.toLowerCase());
  });
}

/**
 * Session allowlist plus mode rules. "Always allow" answers are remembered
 * for the session: per tool for file writes, per command prefix for shell.
 */
export class Permissions {
  private allowedTools = new Set<string>();
  private allowedPrefixes = new Set<string>();

  constructor(public mode: PermissionMode) {}

  decide(kind: ToolKind, toolName: string, command?: string): Decision {
    if (kind === "read") return "allow";
    if (kind === "exec" && command !== undefined) {
      if (dangerReason(command)) return "ask-dangerous";
      if (isReadOnlyCommand(command)) return "allow";
      if (this.mode === "auto") return "allow";
      if (this.allowedPrefixes.has(commandPrefix(command))) return "allow";
      return "ask";
    }
    if (kind === "exec") return this.mode === "auto" || this.allowedTools.has(toolName) ? "allow" : "ask";
    // write
    if (this.mode !== "ask") return "allow";
    return this.allowedTools.has(toolName) ? "allow" : "ask";
  }

  allowAlways(toolName: string, command?: string): void {
    if (command !== undefined) this.allowedPrefixes.add(commandPrefix(command));
    else this.allowedTools.add(toolName);
  }
}

/** First word, or first two for tools with subcommands (`npm test`, `git commit`). */
export function commandPrefix(command: string): string {
  const words = command.trim().split(/\s+/);
  const multi = new Set(["npm", "pnpm", "yarn", "git", "jac", "cargo", "go", "python", "python3", "pip", "npx", "make", "docker"]);
  return multi.has(words[0]!) && words[1] ? `${words[0]} ${words[1]}` : words[0]!;
}
