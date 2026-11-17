import fs from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";

interface Snapshot {
  /** File contents before the turn touched it; null if the file did not exist. */
  before: string | null;
}

/**
 * Records every file's contents before the agent first changes it in a turn,
 * so a whole turn can be undone and the session's changes can be diffed.
 * Works with or without git.
 */
export class Checkpoints {
  private turns: { label: string; files: Map<string, Snapshot> }[] = [];
  /** Contents of each touched file at the start of the session. */
  private originals = new Map<string, string | null>();
  private current: { label: string; files: Map<string, Snapshot> } | null = null;

  beginTurn(label: string): void {
    this.current = { label, files: new Map() };
  }

  endTurn(): void {
    if (this.current && this.current.files.size > 0) this.turns.push(this.current);
    this.current = null;
  }

  /** Call before modifying `abs`. Only the first call per turn records. */
  record(abs: string): void {
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (!this.originals.has(abs)) this.originals.set(abs, before);
    if (!this.current) this.beginTurn("(untracked)");
    if (!this.current!.files.has(abs)) this.current!.files.set(abs, { before });
  }

  canUndo(): boolean {
    return this.turns.length > 0 || (this.current?.files.size ?? 0) > 0;
  }

  /** Reverts the most recent turn that changed files. Returns the restored paths. */
  undo(): { label: string; files: string[] } | null {
    if (this.current && this.current.files.size > 0) this.endTurn();
    const turn = this.turns.pop();
    if (!turn) return null;
    const restored: string[] = [];
    for (const [abs, snap] of turn.files) {
      if (snap.before === null) {
        if (fs.existsSync(abs)) fs.rmSync(abs);
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, snap.before);
      }
      restored.push(abs);
    }
    return { label: turn.label, files: restored };
  }

  /** Unified diff of everything changed this session. */
  sessionDiff(root: string): string {
    const parts: string[] = [];
    for (const [abs, before] of this.originals) {
      const after = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
      if (before === after) continue;
      const rel = path.relative(root, abs);
      parts.push(
        createTwoFilesPatch(
          before === null ? "/dev/null" : `a/${rel}`,
          after === null ? "/dev/null" : `b/${rel}`,
          before ?? "",
          after ?? "",
          "",
          "",
          { context: 3 },
        ),
      );
    }
    return parts.join("\n");
  }

  changedFiles(): string[] {
    const out: string[] = [];
    for (const [abs, before] of this.originals) {
      const after = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
      if (before !== after) out.push(abs);
    }
    return out;
  }
}
