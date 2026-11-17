# jaccode

A terminal AI coding agent with first-class support for the [Jac language](https://www.jac-lang.org).
It reads your project, plans, edits files, runs commands and checks its own work. It runs on Claude, or
fully offline on local models through Ollama.

```
◆ jaccode v0.1.0  claude-opus-5-5 · effort high · auto-edit
  ~/projects/graph-app
  14 .jac files · jac 0.8.x · memory: JAC.md

› add a walker that counts nodes reachable from root, and a test for it
✻ I'll look at the existing walkers first…
● glob **/*.jac
  ⎿ 14 results
● read src/walkers.jac
  ⎿ 88 lines
● edit src/walkers.jac
  ⎿ Edited src/walkers.jac: 1 replacement (+12 -0)
● jac check src/walkers.jac
  ⎿ [exit code 0]
```

## Install

Requires Node.js 20 or later.

```bash
git clone <this repo> jaccode && cd jaccode
npm install && npm run build
npm link        # puts `jaccode` and `jc` on your PATH
```

For Jac work, install the Jac toolchain too: `pip install jaclang`.

## Credentials

- **Claude (default):** set `ANTHROPIC_API_KEY`, or sign in once with `ant auth login`.
- **Local models:** run `ollama serve`, pull a model with tool support (for example
  `ollama pull qwen3-coder`), then start with `jaccode -m ollama:qwen3-coder`. Nothing leaves your machine
  and no key is needed. Set `OLLAMA_HOST` if Ollama isn't on `localhost:11434`.

## Usage

```bash
jaccode                                  # interactive session in the current directory
jaccode "make the tests pass"            # start with a first request
jaccode -p "explain @src/main.jac"       # one answer, then exit (pipe-friendly)
cat build.log | jaccode -p "why did this fail?"
jaccode --resume                         # continue the last session in this project
jaccode --verify "npm test"              # run the tests after every change
jaccode --yolo                           # no permission prompts (dangerous commands still ask)
```

| Option | |
|---|---|
| `-p, --print <prompt>` | Run one request, print the answer to stdout, exit. Progress goes to stderr. |
| `-m, --model <id>` | Claude model id (default `claude-opus-5-5`), or `ollama:<model>` |
| `--provider <name>` | `anthropic` or `ollama` |
| `-e, --effort <level>` | `low`, `medium`, `high` (default), `xhigh`, `max` |
| `--mode <mode>` | `ask`, `auto-edit` (default), `auto` |
| `--yolo` | Same as `--mode auto` |
| `--verify <cmd>` | Command to run after the agent changes files |
| `--no-thinking` | Hide the model's reasoning summary |
| `--no-jac-check` | Don't run `jac check` automatically |
| `-r, --resume [id]` | Resume the latest session here, or a given id |
| `-C, --cwd <dir>` | Project root |

### In a session

| Command | |
|---|---|
| `/model [id]` | Show or switch model, including to and from `ollama:<model>` |
| `/effort [level]` | Reasoning effort |
| `/mode [mode]` | Permission mode |
| `/undo` | Revert every file the last request changed (works without git) |
| `/diff` | Unified diff of everything changed this session |
| `/plan` | The agent's current checklist |
| `/verify [cmd\|off]` | Set the check that runs after changes |
| `/cost` | Tokens and estimated cost, per model |
| `/init` | Have the agent explore the project and write `JAC.md` |
| `/remember <note>` | Append a note to `JAC.md` |
| `/clear`, `/sessions`, `/resume <id>` | Conversation management |

Input shortcuts: `@path/file` attaches a file, `!command` runs a shell command yourself and adds its output
to your next message, a line ending in `\` continues on the next line, and Ctrl+C cancels the running
request.

## What it does

**Checks its own work.** After the agent changes `.jac` files it runs `jac check` on them. If you set a
verify command (`--verify "pytest -q"`), that runs too. Failures go back to the agent to fix before it
hands control back, for up to two rounds. The system prompt also tells it never to claim something works
without running it.

**Jac-aware.** It knows the project's Jac toolchain version, counts the `.jac` files, carries a short
primer on the syntax models usually get wrong (it tends to come out as Python or JSX), and has a `jac` tool
for `check`, `run`, `test` and `format`. Where the primer and the compiler disagree, the agent is told
to go with the compiler.

**Safe edits.**
- A file can't be edited until it has been read. If it changed on disk since that read, the edit is
  refused and the agent re-reads it.
- Edits are exact-string replacements that must be unique. When a match fails, the agent is told which
  line looks closest so it can retry.
- `multi_edit` applies several edits all-or-nothing.
- Every change is checkpointed, so `/undo` restores the files and `/diff` shows the whole session.
- Paths are confined to the project root, including through symlinks.

**Sensible permissions.** Read-only commands (`ls`, `git status`, `grep`, pipelines of them…) never prompt.
Edits prompt with a coloured diff in `ask` mode. "Always" remembers your yes for the session, per tool or
per command prefix (`npm test`, `jac check`). Destructive commands always ask, even in `--yolo`: `rm -rf`
on broad paths, `sudo`, `curl | sh`, force pushes, `git reset --hard`, publishing.

**Robust loop.** Read-only tool calls run in parallel. Tool inputs are schema-validated before anything
runs. A tool call cut off at the output limit isn't executed. The agent gets a nudge if it repeats the
same call three times, and Ctrl+C cancels cleanly, including running shell commands.

**Long sessions.** On Claude it streams every turn and uses adaptive thinking, prompt caching (tools,
system prompt and conversation) and server-side context compaction. Where the model supports it, the
server-side refusal fallback is on. Sessions are saved to `~/.jaccode/sessions` and can be resumed.

**Project memory.** `JAC.md` (plus `AGENTS.md` / `CLAUDE.md` if present, and a personal
`~/.jaccode/JAC.md`) is loaded into every session. `/init` writes one for you.

## Configuration

Settings merge in this order: defaults, `~/.jaccode/config.json`, `<project>/.jaccode.json`, environment
(`JACCODE_PROVIDER`, `JACCODE_MODEL`, `JACCODE_EFFORT`), then flags.

```json
{
  "provider": "anthropic",
  "model": "claude-opus-5-5",
  "effort": "high",
  "mode": "auto-edit",
  "verifyCommand": "jac test main.jac",
  "showThinking": true,
  "autoJacCheck": true,
  "ollamaHost": "http://127.0.0.1:11434"
}
```

## Development

```bash
npm run dev -- -p "hello"   # run from source with tsx
npm test                     # unit + agent-loop tests (no network)
npm run typecheck
```

Layout: `src/agent.ts` (the loop, permissions, verification), `src/providers/` (Anthropic, Ollama, a
scripted mock for tests), `src/tools/` (file, search, shell and Jac tools; Zod schemas generate the JSON
Schema the model sees), `src/checkpoints.ts` (undo/diff), `src/cli.ts` (REPL and flags).

## License

MIT
