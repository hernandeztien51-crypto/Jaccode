# jaccode

A terminal AI coding agent with first-class support for the [Jac language](https://www.jac-lang.org).
It reads your project, plans, edits files, runs commands and checks its own work. It runs on Claude, or
fully offline on local models through Ollama.

```
◆ jaccode v0.1.0  claude-opus-5-5 · effort high · auto-edit
  ~/projects/graph-app
  14 .jac files · jac 0.40.0 · memory: JAC.md

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

For Jac work, install the Jac toolchain too (the `jaclang` pip package is outdated; Jac now ships as one binary):

```bash
curl -fsSL https://raw.githubusercontent.com/jaseci-labs/jaseci/main/scripts/install.sh | bash
```

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
| `--lite`, `--no-lite` | Small-model mode: short prompt, core tools, short tool output (default: on for Ollama) |
| `-r, --resume [id]` | Resume the latest session here, or a given id |
| `-C, --cwd <dir>` | Project root |
| `--record <file>` | Save every request as a training trajectory (JSONL, chat-messages format) |

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
| `/check [files]`, `/test [files]`, `/run [file]` | Run the Jac compiler directly: instant, no model tokens. Defaults to the `.jac` files changed this session |
| `/fix [files]` | Run `jac check` and hand any errors to the agent |
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

**Jac-aware.** It knows the project's Jac toolchain version and counts the `.jac` files. It carries a compact
cheat sheet for Jac 0.40, condensed from the official guides that ship with `jac`, covering the mistakes models
make most: Python- or JS-style syntax, brace imports with `;`, `root()`, `&&`, non-exhaustive enum matches.
Its `jac` tool runs `check`, `run`, `test`, `format` and `guide`, so the agent can read the official guides
itself. `jac check` and `jac guide` count as read-only, so they never prompt. Where the cheat sheet and the
compiler disagree, the agent is told to go with the compiler.

**Reads compiler errors properly.** `jac check` output is parsed into one line per problem: file, line, error
code, a fix hint for the common codes, and the guide the compiler points to. Duplicates are dropped, so the model
gets short, focused feedback instead of pages of raw output.

**Code outline.** The `outline` tool lists the declarations in a file or folder with line numbers: functions,
objects, nodes, edges, walkers, abilities, tests, plus Python and TypeScript classes and functions. The agent can
see a project's structure without reading whole files.

**Small-model mode.** With Ollama models, jaccode switches to small-model mode automatically:
- a shorter prompt;
- seven core tools instead of eleven;
- tool output capped at 6,000 characters;
- tools that weren't offered are refused.

A small local model has less to get wrong and less context to fill. Use `--lite` to turn it on for any model, or
`--no-lite` to turn it off.

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

## Jac benchmark

`evals/jac` holds 25 Jac tasks graded by the compiler:
- writing functions, objects and enums
- nodes, typed edges and walkers
- fixing Python-style syntax and logic bugs
- adding a feature
- porting Python
- importing across files
- `.impl.jac` implementation files
- `by llm()` functions, tested with a mock model so they run offline

The summary also lists the compiler error codes the model hit most, which shows what extra training data it needs.

Each task gets a fresh folder. The agent works on it, then hidden tests are added and run with `jac test`.

```bash
jaccode eval                                   # current model; prints pass@1, compile rate, foreign-syntax rate
jaccode eval -m ollama:hf.co/you/jac-2b-GGUF:Q5_K_M --out results.json
jaccode eval --reference                       # grade the reference solutions (validates the suite)
jaccode eval --only fizzbuzz,sum_tree --record runs.jsonl
```

## Training your own model

`training/` builds a small Jac-specialised model that runs locally with no API key:
1. Compiler-verified training data.
2. A LoRA fine-tune of Qwen3.5-2B on a free Colab GPU.
3. Optional reinforcement learning with the Jac compiler as the reward.
4. A ~1.4 GB GGUF file you run through Ollama.

The quickest start is `training/jaccode_pipeline.ipynb` in Google Colab. It runs the whole pipeline, from installing
Jac to a before/after score. Details are in `training/README.md`, and the research behind it is in `reports/`.

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

Layout:
- `src/agent.ts`: the loop, permissions and verification.
- `src/providers/`: Anthropic, Ollama, and a scripted mock for tests.
- `src/tools/`: the file, search, shell and Jac tools. Zod schemas generate the JSON Schema the model sees.
- `src/jac/cheatsheet.ts`: the Jac notes in the prompt.
- `src/eval.ts`: the benchmark runner.
- `src/recorder.ts`: training trajectories.
- `src/checkpoints.ts`: undo and diff.
- `src/cli.ts`: the REPL and flags.
- `evals/jac/`: the benchmark tasks.
- `training/`: the model pipeline.

## License

MIT
