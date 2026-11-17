import readline from "node:readline";

/**
 * Buffered line input. readline's question() drops lines that arrive while
 * no question is pending (pasted or piped input), so lines are queued here and
 * handed out in order, to the main prompt and to permission questions alike.
 */
export class LineReader {
  readonly rl: readline.Interface;
  private queue: string[] = [];
  private waiter: ((line: string | null) => void) | null = null;
  private closed = false;

  constructor(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, terminal: boolean) {
    this.rl = readline.createInterface({ input, output, terminal });
    this.rl.on("line", (line) => {
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        if (!terminal) output.write(line + "\n");
        w(line);
      } else this.queue.push(line);
    });
    this.rl.on("close", () => {
      this.closed = true;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w(null);
      }
    });
  }

  /** Shows `prompt` and resolves with the next line, or null once input has ended. */
  ask(prompt: string): Promise<string | null> {
    this.rl.setPrompt(prompt);
    this.rl.prompt();
    if (this.queue.length) {
      const line = this.queue.shift()!;
      if (!this.rl.terminal) process.stdout.write(line + "\n");
      return Promise.resolve(line);
    }
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => (this.waiter = resolve));
  }

  /** Clears the line being typed. */
  clearLine(): void {
    this.rl.write(null, { ctrl: true, name: "u" });
  }

  get isClosed(): boolean {
    return this.closed && this.queue.length === 0;
  }

  close(): void {
    this.rl.close();
  }
}
