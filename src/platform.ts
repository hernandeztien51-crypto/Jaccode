import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, type ChildProcess } from "node:child_process";

export const isWindows = process.platform === "win32";

/** Finds an executable on PATH (honours PATHEXT on Windows). */
export function which(cmd: string): string | null {
  const exts = isWindows ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, isWindows && !cmd.toLowerCase().endsWith(ext) ? cmd + ext : cmd);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

export interface Shell {
  /** Display name: bash, sh, powershell, pwsh, cmd. */
  name: string;
  file: string;
  /** Arguments that run one command string. */
  args(command: string): string[];
}

function shellFor(file: string): Shell {
  const base = path.basename(file).toLowerCase().replace(/\.exe$/, "");
  if (base === "powershell" || base === "pwsh") return { name: base, file, args: (c) => ["-NoProfile", "-NonInteractive", "-Command", c] };
  if (base === "cmd") return { name: "cmd", file, args: (c) => ["/d", "/s", "/c", c] };
  return { name: base, file, args: (c) => ["-c", c] };
}

let cached: Shell | undefined;

/**
 * The shell commands run in. JACCODE_SHELL overrides. On Windows, Git Bash is preferred (models write bash),
 * then PowerShell; PATH's `bash` is avoided there because it is usually the WSL launcher.
 */
export function defaultShell(): Shell {
  if (cached) return cached;
  const override = process.env.JACCODE_SHELL;
  if (override) return (cached = shellFor(which(override) ?? override));
  if (!isWindows) return (cached = shellFor(which("bash") ?? "/bin/sh"));
  const gitBash = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], path.join(os.homedir(), "AppData", "Local", "Programs")]
    .filter(Boolean)
    .map((d) => path.join(d!, "Git", "bin", "bash.exe"))
    .find((p) => fs.existsSync(p));
  if (gitBash) return (cached = shellFor(gitBash));
  return (cached = shellFor(which("pwsh") ?? which("powershell") ?? "powershell.exe"));
}

/** Kills a process and everything it started. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export function platformLabel(): string {
  const names: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux", android: "Android" };
  return `${names[process.platform] ?? process.platform} ${os.release()} (${process.arch})`;
}
