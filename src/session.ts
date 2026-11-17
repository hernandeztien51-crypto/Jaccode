import fs from "node:fs";
import path from "node:path";
import { globalDir } from "./prompt.js";

export interface SavedSession {
  id: string;
  root: string;
  provider: string;
  model: string;
  created: string;
  updated: string;
  title: string;
  history: unknown;
}

function dir(): string {
  const d = path.join(globalDir(), "sessions");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function newSessionId(): string {
  const t = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${t}-${Math.random().toString(36).slice(2, 6)}`;
}

export function saveSession(s: SavedSession): void {
  const file = path.join(dir(), `${s.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, file);
}

export function listSessions(root?: string): SavedSession[] {
  const out: SavedSession[] = [];
  for (const f of fs.readdirSync(dir())) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir(), f), "utf8")) as SavedSession;
      if (!root || s.root === root) out.push(s);
    } catch {
      /* skip unreadable files */
    }
  }
  return out.sort((a, b) => b.updated.localeCompare(a.updated));
}

export function loadSession(id: string | true, root: string): SavedSession | undefined {
  if (id === true) return listSessions(root)[0];
  const exact = path.join(dir(), `${id}.json`);
  if (fs.existsSync(exact)) return JSON.parse(fs.readFileSync(exact, "utf8")) as SavedSession;
  return listSessions().find((s) => s.id.startsWith(id));
}
