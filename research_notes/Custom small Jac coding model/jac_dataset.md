# Building a training dataset for a small Jac coding and tool-using agent model

Research date: 2026-11-17. Method: shallow clone of `github.com/jaseci-labs/jaseci` (HEAD `b217cb8`, committed 2026-11-17), PyPI API, web fetches of GitHub READMEs and arXiv papers. File and line counts below are my own measurements on that clone (`find`/`wc`) and will drift as the repo moves fast. Repo-file citations point to the equivalent path on GitHub `main`.

---

## Q1. What Jac material exists publicly (repo, docs, grammar, examples, agent guides, llms.txt), how big is it, and under what licences?

### Takeaway
The monorepo alone holds about **6,600 `.jac` files and about 1.04M lines of Jac**, all MIT-licensed. Most of it is compiler/runtime self-hosting code and compiler test fixtures, not idiomatic app code. On top of that there are about 111 Markdown doc pages (about 61K lines, about 1,070 ```` ```jac ```` code fences), 45 bundled "agent skill" guides (about 5.8K lines), a 570-line auto-generated EBNF grammar, and a built-in MCP server with compiler tools. Jaseci Labs has already run its own Jac fine-tuning experiments (`Jac_Model_Experiments`, `Jac_Model_Studio`), but they were pinned to an **old compiler (jaclang 0.16.1)**.

### Cited Findings
**Repo scale and layout (measured on clone 2026-11-17)**
- Repo-wide: 6,595 `.jac` files, 1,042,855 total lines. Median file is about 44 lines. 1,209 files are `.impl.jac` (implementation annexes split from declarations). 41 groups of byte-identical duplicate files exist. — [jaseci-labs/jaseci](https://github.com/jaseci-labs/jaseci)
- By area:
  - `jac/tests`: 3,630 files, about 319K lines. Most are compiler fixtures: `tests/compiler/backends` 1,616, `tests/compiler/passes` 916, `tests/compiler/fixtures` 280, `tests/language/fixtures` 194.
  - `jac/jaclang`: 2,535 files, about 680K lines. This is the self-hosted compiler, runtime, native stdlib (`runtime/na_stdlib` 229), `scale` (serving/deploy), `byllm`, client, CLI, MCP server and so on.
  - `jac/examples`: 404 files, about 37.8K lines. — [jac/ tree](https://github.com/jaseci-labs/jaseci/tree/main/jac)
- Example apps in `jac/examples`: `chess` (which also ships `other_langs/chess.py` and `chess.cpp`, giving a parallel Python/C++/Jac triple), `day_planner`, `jaclang_org` (the jac-lang.org site itself: 299 files in `core`, 36 in `pages`, plus its own `AGENTS.md`), `mini_todo`, `notes-app`, `ownbench`, `raylib_shooter`, `tiny_jacyac`, `todo_app`. — [jac/examples](https://github.com/jaseci-labs/jaseci/tree/main/jac/examples)
- Licence: the root `LICENSE` is MIT ("Copyright (c) 2020 Jason Mars"). Sub-licences exist for vendored or third-party parts: `jac/native/LICENSE` (BSD-style, Anaconda, numba/llvmlite lineage), `osprey/LICENSE` (MIT, 2026 Nitin Shankar Madhu), vendored typeshed, wasi-libc, musl, compiler_rt and llvmlite. These are mostly non-Jac files. — [LICENSE](https://github.com/jaseci-labs/jaseci/blob/main/LICENSE)
- PyPI `jaclang` reports licence "MIT". The last PyPI release is **0.16.7 (2026-06-19)**. Note that PyPI also lists a stray "2.0.0" version string. — [PyPI jaclang](https://pypi.org/project/jaclang/)

**Current version and distribution**
- The in-repo release notes list **"jaclang 0.40.0 (Latest Release)"**. — [release_notes/jaclang.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/community/release_notes/jaclang.md)
- Install is now a standalone binary via `curl -fsSL https://raw.githubusercontent.com/jaseci-labs/jaseci/main/scripts/install.sh | bash`, with version pinning such as `--version 0.34.1`. This replaces pip. The repo contains `build.zig` and `launcher`. — [quick-guide/install.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/quick-guide/install.md)
- Breaking-change entries link PRs at `github.com/jaseci-labs/jac/pull/...`. A search result also shows a `jaseci-labs/jac` repo ("The ultimate language for agents to build everything"). The monorepo may have been renamed or mirrored; I did not verify which is canonical. — [breaking-changes.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/community/breaking-changes.md); [jaseci-labs/jac](https://github.com/jaseci-labs/jac)

**Docs, reference and grammar**
- The docs source lives in `jac/jaclang/cli/docs/` with sections `quick-guide`, `tutorials`, `reference`, `internals`, `community`, `build`. There are 111 `.md` files, about 61K lines, and 1,069 ```` ```jac ```` fences. Language reference pages (`reference/language/`, about 14.8K lines) are: foundation, primitives, types-and-values, variables-and-scope, control-flow, operators, functions-objects, osp, walker-responses, access-modifiers, concurrency, comptime, ownership-borrowing, native-pathway, python-integration, library-mode, advanced, syntax-cheatsheet. — [docs/reference/language](https://github.com/jaseci-labs/jaseci/tree/main/jac/jaclang/cli/docs/reference/language)
- The grammar is `jac/jaclang/jac.spec`, a 570-line "Auto-generated EBNF snapshot of the Jac grammar … regenerate with `jac tool grammar -o <path>`". — [jac.spec](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/jac.spec)
- `docs.jaseci.org/llms.txt` is a short index of about 1,000 words and 25 links:
  - Getting started: 9 links.
  - Tutorials: 8 links, including `by llm()` quickstart, full-stack apps, AI agents.
  - Reference: 4 links (CLI, byllm, jac-scale).
  - Optional: research papers, GitHub, an "agent setup skill" SKILL.md, a browser playground.
  - Its syntax bullets show `has name: type;` and `def f(...) -> T by llm();`.
  - I found no `llms-full.txt` link. — [docs.jaseci.org/llms.txt](https://docs.jaseci.org/llms.txt)

**Agent-oriented guides (the closest thing to "jac-coder" prompts)**
- `jac guide` ships 45 versioned guides inside the CLI, about 5.8K lines in `jac/jaclang/cli/skills/*.md`. Examples: `jac-essentials`, `jac-core-cheatsheet`, `jac-types`, `jac-walker-patterns`, `jac-by-llm`, `jac-sv-*`, `jac-cl-*`, `jac-native*`, `jac-testing`.
  - `jac guide --export ~/.claude/skills` writes them as Claude Code / Cursor Agent Skills.
  - `jac create` seeds an `AGENTS.md`.
  - `jac check` diagnostics point to a guide (for example "run 'jac guide jac-types'").
  - The docs say: "AI coding assistants are good at Jac's *ideas* but often wrong about its *syntax*". — [agent-skills-and-mcp.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/reference/agent-skills-and-mcp.md)
- The `jac mcp` server exposes these tools, which are useful both as the tool vocabulary for agent trajectories and as verifiers: `validate_jac`, `check_syntax`, `lint_jac`, `format_jac`, `py_to_jac`, `jac_to_py`, `jac_to_js`, `explain_error`, `list_examples`/`get_example`, `search_docs`, `get_ast`, `run_jac` (code, entrypoint, timeout), `graph_visualize`, `get_resource`, `list_commands`/`get_command`/`execute_command`, `write_module`/`write_impl`/`write_walker`/`write_node`/`write_test`/`write_ability`, `debug_error`, `fix_type_error`, `migrate_python`. — [reference/mcp.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/reference/mcp.md)
- **`jac ai` (the built-in terminal coding agent) and `jac ninja` were removed** (PR #8468). "agent workflows continue through `jac mcp` plus the bundled guides (`jac guide`)". — [breaking-changes.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/community/breaking-changes.md)
- Source transforms: `jac tool py2jac`, `jac tool jac2py`, `jac tool jac2js` (formerly top-level `jac py2jac` etc.). — [reference/cli/index.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/reference/cli/index.md)

**Prior Jac fine-tuning work by Jaseci Labs**
- `jaseci-labs/Jac_Model_Studio` is a local workbench: sources → synthesize dataset → curate → train (local MLX via `mlx_lm.lora`, or bring-your-own remote GPU) → eval → chat. Its shipped config points at "base Qwen3-Coder q4 + the 08 SFT adapter" and the "08 SFT/DPO datasets". No licence is shown. — [Jac_Model_Studio](https://github.com/jaseci-labs/Jac_Model_Studio)
- `jaseci-labs/Jac_Model_Experiments` setup:
  - Base model Qwen3-Coder-30B-A3B-Instruct, 4-bit MLX, LoRA, "plain SFT on 16 Spectrum-selected decoder blocks", optional DPO, on a 48 GB Apple Silicon Mac.
  - **Pinned jaclang==0.16.1.**
  - Functional eval (compiles and runs) on an 855-row shared holdout. Base model: **10.5% (90/855)**. Best fine-tunes: exp04 74.7%, exp06 74.4%, exp07 73.0% (DPO), exp08 70.5%.
  - About 4 h training and 1 h eval. No licence stated. — [Jac_Model_Experiments](https://github.com/jaseci-labs/Jac_Model_Experiments)
- Its HISTORY gives dataset sizes per experiment:
  - **01**: 1,500 `py2jac` rows from mined runnable Python plus 147 hand-written idiomatic rows, and 147 DPO pairs (chosen = idiomatic, rejected = "transpile-shaped").
  - **03**: continued pretraining on docs, OSP paper and blogs.
  - **04**: 8,100 SFT and 654 DPO pairs from a "jacgen2" pipeline.
  - **06**: 5,474 rows.
  - **07**: 6,781 rows.
  - **08**: 14,792 rows from 7 merged sources (js2jac, py2jac, CRUD walkers, OSP graph-native modules and others).
  - Gate: `jac run`, not `jac check`, which "over-rejects idiomatic untyped Jac" (at 0.16.x).
  - exp08 added eval-denylist, test-count and licence filters. — [Jac_Model_Experiments HISTORY.md](https://raw.githubusercontent.com/jaseci-labs/Jac_Model_Experiments/main/docs/HISTORY.md)

### Inferences
- Usable idiomatic source is far smaller than the 1M-line headline. Roughly 40K lines of examples, 1K doc code fences and 5.8K lines of guides are "user-style" Jac. The compiler/runtime (680K lines) is real, current-syntax Jac but skews toward systems and compiler code. Test fixtures (319K lines) include many intentionally invalid or edge-case files, so they must be filtered by expected-pass/expected-fail before use.
- The 41 duplicate groups and the `.impl.jac`/declaration split mean dedup and pairing logic is needed. Pairing `foo.jac` with `foo.impl.jac` into one sample is probably better than splitting them.
- `chess/other_langs` (Python, C++, Jac) is a ready-made parallel example. The `py_to_jac` / `jac tool py2jac` transform gives a free but "transpile-shaped" seed translator (see Q3).
- All monorepo data is MIT, which permits training. Keep attribution, and exclude vendored non-Jac licences (BSD numba, typeshed and so on) if you ingest non-`.jac` files.

### Gaps
- I could not access the GitHub API (session restriction), so release tags and star counts were not verified, and jac-lang.org was not separately fetched. The jac-lang.org site source is in `jac/examples/jaclang_org`.
- Jac_Model_Experiments datasets: I could not confirm whether the jsonl files themselves are public or what licence they carry. The `chess10kp/jac-data-gen` generator repo was not inspected.
- I did not search for third-party Jac code (for example GitHub-wide `language:Jac` or the Jaseci "Agentic-AI" course repos). These are probably small and likely use pre-0.35 syntax.

---

## Q2. Current Jac syntax and how it changed across versions

### Takeaway
Jac changed a lot in 2026. Between jaclang 0.16 (PyPI, mid-2026) and 0.40 (binary, Nov 2026) there were many clean breaks with no deprecation window. Any scraped or older data (including Jaseci's own 0.16.1-era training sets) must be re-validated with the **latest** `jac check`. Since type checking now runs on every compile, "it ran under old jac" is no longer a valid filter.

### Cited Findings
- **Current core syntax**, per the `jac-essentials` guide:
  - `{}` blocks and `;`.
  - `def f(x: int) -> str { ... }` for functions.
  - `obj` / `node` / `edge` / `walker` archetypes.
  - `has` fields, with types required.
  - `glob` for module variables.
  - `with entry:__main__ { ... }` for executable code.
  - `import os;` and `import from math { sqrt }` (no trailing semicolon on the brace form).
  - Walkers use `can name with Type entry` abilities.
  - `root` is a value, not `root()`.
  - `self`/`here`/`visitor` semantics; `visit`, `report`, `skip`, `disengage`.
  - "Run `jac check` after editing… Parser success alone does not check types." — [jac-essentials.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/skills/jac-essentials.md)
- **Legacy syntax removed in one clean break (#7514)**. Each old spelling is now an error:
  - `can foo() {}` becomes `def foo() {}` (E0034). `can` is "only for abilities with `with entry` / `with exit`".
  - `global`/`nonlocal` are removed (nearest-enclosing-binding semantics; `glob` only).
  - `&&`/`||` become `and`/`or`.
  - `abs` becomes `abst` for abstract methods.
  - `[-->(?:Type)]` becomes `[-->[?:Type]]` (E0048).
  - `root()` becomes `root` (E0049).
  - `by postinit` becomes `postinit`.
  - `for i = 0 to i < 10 by i += 1` becomes `for i = 0 while i < 10 with i += 1`.
  - Backticked Python reserved words as field names are rejected (E0067). — [breaking-changes.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/community/breaking-changes.md)
- Other breaks listed (version tag or "unreleased" as stated in the page):
  - **Placement markers removed (0.35):** `sv {}` / `cl {}` / `na {}` blocks, `cl import`, `.sv.jac`/`.cl.jac`/`.na.jac` suffixes, `variant client;`, and the `to cl:` section markers. Placement is now inferred; `[placement.pins]` in `jac.toml` overrides it.
  - **byLLM folded into core:** `import from byllm.lib { Model }` becomes `import from jaclang.byllm.lib { Model }`. The `by llm()` syntax is unchanged. MTLLM was the older name before byLLM.
  - **jac-scale folded into core:** `jac_scale` becomes `jaclang.scale`.
  - **Inline Python `::py::` removed:** move the code to a `.py` module and import it.
  - **Keywords can never be identifiers:** use a backtick escape (E0013); a stray backtick is E0014.
  - **`typing` imports:** `import from typing { Any }` is an error; use `any`. `List`/`Dict`/... are errors; use lowercase builtins. Callable, Sequence and similar are ambient.
  - **Type checking runs on every compilation**, including `jac run`. `--no_typecheck` is removed.
  - **Endpoint exposure:** plain `def`/`walker` are private; `:protect` marks an authenticated endpoint.
  - **Edges must name their endpoints.**
  - **`region {}`** becomes `in Region() {}`.
  - **CLI changes:** `jac start`/`jac dev` become `jac run --serve`/`--dev`; `jac py2jac` becomes `jac tool py2jac`.
  - **Persistence:** Postgres is the only engine (0.36). — [breaking-changes.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/community/breaking-changes.md)
- `by llm()` in current form is `def f(...) -> T by llm();`, where the return type is the output schema, and `sem` adds semantic strings. In byLLM, `method="ReAct"` is deprecated: "the ReAct loop turns on automatically when you pass `tools=[...]`". — [docs llms.txt](https://docs.jaseci.org/llms.txt); [jac-by-llm.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/skills/jac-by-llm.md)
- In the current repo, 0 `.jac` files contain function-style `can name(` (my grep). The in-repo corpus already matches post-#7514 syntax. — [jaseci-labs/jaseci](https://github.com/jaseci-labs/jaseci)

### Inferences
- **Mark as OLD (pre-0.35 / pre-#7514):**
  - Any Jac from Jaseci 1.x (`.jac` with `walker init {}` / `has anchor`, the 2020–2023 jaseci v1 language).
  - Early jaclang (2024–2025) code using `can` for functions, `:can:`/`:obj:` impl syntax, `include`, `<>` names, and `import:py`.
  - MTLLM-era `by llm` imports.
  - Any `sv`/`cl` marker code.
  - Data built against jaclang 0.16.x (for example Jac_Model_Experiments).
- Pin one compiler version (0.40.x) for the whole pipeline, store the version in each sample's metadata, and re-run validation when you upgrade.
- Breaking-changes tables (old → new) can themselves become "migrate this legacy Jac" training pairs, which is useful because users will paste old code.

### Gaps
- No per-version changelog mapping of which jaclang version introduced `def` and dropped `can` for functions. The #7514 entry has no version number.
- I did not verify jac-lang.org's content separately from the repo docs.

---

## Q3. Proven methods to generate more training data for a low-resource language

### Takeaway
The best-evidenced recipe is **MultiPL-T style**: take Python functions that have tests, have an LLM translate both code and tests, and keep only outputs that compile and pass. It yields tens of thousands of verified items per language, and fine-tuning on them gives large gains even at 1B scale. Complement it with OSS-Instruct-style generation seeded from real Jac snippets and docs (to get idiomatic OSP, walker and `by llm` code rather than Python-shaped code), with Evol-Instruct difficulty scaling, and with DPO preferring idiomatic over transpile-shaped Jac. Jaseci's own experiments show mix and idiomaticity matter more than raw row count.

### Cited Findings
- **MultiPL-T** (Cassano et al., arXiv 2308.09895):
  - Pipeline: StarCoderBase-15B translates Python functions; StarCoder-15B generates the unit tests. Faulty tests and low-coverage code are filtered out, then the translations are validated with the tests.
  - Funnel: 22,311,478 Python functions → 432,361 after filtering → 133,168 after the ≥90% line-coverage filter.
  - Validated items: Lua 48,194, Julia 45,000, OCaml 43,401, Racket 40,510, R 37,592.
  - Ablation used 25K per language.
  - MultiPL-E pass@1, base → fine-tuned:

    | Language | 1B | 15B |
    |---|---|---|
    | OCaml | 1.5 → 9.7 | 6.9 → 19.9 |
    | Racket | 4.7 → 11.3 | 11.8 → 21.0 |
    | Julia | not captured | 21.1 → 35.2 |

  - Training: 1B for 7 epochs at lr 3e-5; 15B and larger for 10 epochs at lr 2e-5.
  - Racket and OCaml improved substantially after one epoch on 25K items; Lua needed more data. — [arXiv 2308.09895](https://arxiv.org/abs/2308.09895); [HTML v6](https://arxiv.org/html/2308.09895v6)
- **Kotlin ML Pack** (JetBrains, arXiv 2405.19250):
  - KStack: 4M files, 3.1B tokens.
  - KStack-clean: 25K files, 22M tokens, selected by an LLM-scored, CodeT5+-trained quality classifier.
  - KExercises: **15K** tasks, about 3.5M tokens, made by translating Python CodeExercises with GPT-3.5-turbo.
  - HumanEval-Kotlin pass@1 for CodeLlama-7B: 26.09 base → 29.19 (KStack) / 37.89 (KStack-clean) / **42.24 (KExercises)**.
  - DeepSeek-coder-6.7B: 40.99 → 55.28 on KExercises.
  - "small, high-quality datasets … can significantly improve model performance". — [arXiv 2405.19250](https://arxiv.org/html/2405.19250)
- **Magicoder / OSS-Instruct** (Wei et al., ICML 2024): about 75K synthetic instructions generated by prompting an LLM with real open-source code snippets as seeds. Combining with Evol-Instruct gives MagicoderS. MagicoderS-CL-7B scores 66.5 on HumanEval+ pass@1 vs ChatGPT's 65.9. — [arXiv 2312.02120](https://arxiv.org/abs/2312.02120)
- **WizardCoder / Evol-Instruct** (Luo et al.): iteratively evolves code instructions to be harder, and claims to beat other open Code LLMs on HumanEval/HumanEval+ (numbers not captured from the abstract). — [arXiv 2306.08568](https://arxiv.org/abs/2306.08568)
- **No-resource languages** (Giagnorio, Martin-Lopez, Bavota, arXiv 2606.16827, June 2026, accepted IEEE TSE):
  - "further pre-training gives the largest performance gains for no-resource languages".
  - Further pre-training instruction-tuned models directly harms instruction following.
  - Their fix: continued pretraining on the **base** model, then add instruction-following via **weight-diff transfer** from the instruct model. — [arXiv 2606.16827](https://arxiv.org/abs/2606.16827)
- A survey of LLM code generation for low-resource and domain-specific languages exists (arXiv 2410.03981), and so does Bridge-Coder (arXiv 2410.18957) for low-resource code. I did not read either in detail. — [survey 2410.03981](https://arxiv.org/pdf/2410.03981); [Bridge-Coder](https://arxiv.org/pdf/2410.18957)
- **Jac-specific evidence** (Jac_Model_Experiments):
  - `py2jac`-translated rows dominated the early data.
  - DPO pairs used chosen = idiomatic and rejected = transpile-shaped.
  - The compiler was used as a reward and best-of-k verifier.
  - exp06 matched exp04 "with 32% fewer rows".
  - exp07 had a bigger, "better-written" pool but did not do better.
  - exp08 had the largest merged corpus (14,792 rows) and scored lowest (70.5% holdout a; 37.7% on holdout b vs 98.2% for 07). The authors infer dilution.
  - "Data mix and fit to the eval surface mattered more than row count". — [HISTORY.md](https://raw.githubusercontent.com/jaseci-labs/Jac_Model_Experiments/main/docs/HISTORY.md)

### Inferences
- A practical Jac pipeline, combining the cited methods:
  1. Seed from Python with tests (MBPP/HumanEval-style, or mined functions like MultiPL-T, licence-filtered). Have a strong model translate code and tests to Jac. Gate on `jac check` (current versions type-check on every compile) plus `jac test`/`run_jac`, and keep only passing items.
  2. OSS-Instruct from real Jac: use snippets from `jac/examples`, doc fences and guides as seeds so the model sees OSP (node/edge/walker), `by llm`, `has`, `impl` annexes and client/server apps, which Python translation never produces.
  3. Evol-Instruct to diversify difficulty.
  4. Optionally add DPO or rejection pairs (idiomatic vs transpile-shaped, or valid vs legacy syntax).
  5. Hold out an eval set decontaminated from all seeds.
- Because exp08 suggests that adding Python-shaped rows can dilute idiomatic skills, budget the mix explicitly. For example, cap translated-function rows and guarantee a share of graph-native/OSP and app-level samples (exp08 had only 15.7% graph-native).
- Given the 2606.16827 finding, if you do continued pretraining on raw Jac (about 1M lines ≈ 10M tokens), apply it to the base model and then transfer the instruct delta, or follow it with SFT. Do not do CPT directly on the instruct checkpoint.

### Gaps
- Exact WizardCoder dataset size and HumanEval figures were not captured (abstract only).
- No per-language MultiPL-T numbers for R/Lua at 1B were captured beyond those listed. I found no published "data scaling curve" for a single low-resource language that clearly identifies a plateau.

---

## Q4. Building tool-use agent trajectories (read/edit/`jac check`/fix) for SFT, and chat formats

### Takeaway
SWE-smith shows the recipe:
- Synthesize many verifiable tasks cheaply, roll out a strong teacher agent, and keep only successful trajectories (rejection-sampling fine-tuning).
- Cap trajectories per task, and SFT the student on them.
- Hundreds of trajectories already help; thousands get near state of the art for a 32B model.

For Jac, tasks can be synthesized by breaking valid Jac (procedural AST mutations, LM-introduced bugs, legacy-syntax injection). The teacher is rolled out with the `jac mcp` tool set (`validate_jac`, `run_jac`, `explain_error`, `fix_type_error`, file write/edit). Data is stored in OpenAI-style `messages` + `tools` JSONL with loss only on assistant tokens.

### Cited Findings
- **SWE-smith** (Yang et al., arXiv 2504.21798):
  - Scale: 50K task instances from 128 repos.
  - Bug synthesis methods: LM Modify, LM Rewrite, procedural AST modifications, PR mirror, combine-bugs.
  - Cost per candidate: 0.00¢ (procedural/combine) to 5.53¢ (PR mirror), average 2.32¢. Total build about $1,360.
  - Trajectories: **5,016** from Claude 3.7 Sonnet, with only resolved instances kept and at most 3 per instance. These fine-tuned Qwen2.5-Coder-32B-Instruct to 40.2% on SWE-bench Verified.
  - A 32B model on **500** trajectories reached 28.2%.
  - **SWE-agent-LM-7B on about 2K trajectories: 15.2%** Verified. — [arXiv 2504.21798](https://arxiv.org/html/2504.21798)
- **SWE-Gym** (Pan et al., arXiv 2412.21139): 2,438 real Python task instances with executable environments and tests. Fine-tuning on sampled trajectories gave up to 19% absolute gains on SWE-bench Verified/Lite. Verifiers trained on trajectories reached 32.0% Verified with best-of-n. — [arXiv 2412.21139](https://arxiv.org/abs/2412.21139)
- **Chat/tool format for SFT** (NVIDIA NeMo AutoModel agent-SFT recipe):
  - Fine-tunes Qwen2.5-3B on `glaive_toolcall_en`.
  - Converts traces to OpenAI chat-completions format, with parallel `tool_calls` merged into one assistant message and tool responses paired by id.
  - Renders through the tokenizer chat template with the `tools` schema.
  - Uses answer-only masking (loss on assistant and tool-call tokens only), so "the model never learns to predict environment outputs".
  - Has options to exclude or strip reasoning. — [NeMo AutoModel agent SFT](https://docs.nvidia.com/nemo/automodel/latest/recipes-e2e-examples/agent-sft)
- NVIDIA Nemotron SDG describes training-ready JSONL with `messages` and `tools` arrays, where each `tool` message carries a `tool_call_id` matching the assistant call. — [Nemotron tool-call data](https://docs.nvidia.com/nemotron/latest/sdg/how-to/tool-call-data.html)
- A practitioner caveat, reported via search summary and not independently verified: Qwen3's chat template deletes `<think>` content from prior turns, so some tutorials render ChatML manually to control masking. — [NeMo agent SFT search result](https://docs.nvidia.com/nemo/automodel/latest/recipes-e2e-examples/agent-sft)
- Jac's own agent loop design: guides tell the model *how*; MCP lets it *verify* against the real compiler. `jac check` diagnostics link to guides. `jac code` gives compiler-backed structural queries (`symbol`, `uses`, `map`, `walkers`, `slice`, `diag`) returning JSON. `jac browse` drives a headless browser for UI verification. — [agent-skills-and-mcp.md](https://github.com/jaseci-labs/jaseci/blob/main/jac/jaclang/cli/docs/reference/agent-skills-and-mcp.md)

### Inferences
- A scaled-down "Jac-smith":
  1. Start from valid Jac programs with tests: in-repo examples, verified MultiPL-T-style translations, and runnable test fixtures.
  2. Create broken variants via (a) procedural AST mutations, (b) LM-introduced bugs, (c) **legacy-syntax injection** (`can` functions, `root()`, `&&`, `byllm` imports, `sv {}` markers), and (d) type errors. Feature requests ("add a walker that…") give generation-style tasks.
  3. Roll out a frontier teacher with tools mirroring the target harness: `read_file`, `edit_file`/`write_file`, `run_command("jac check …")`, `jac test`, `jac guide <topic>`.
  4. Keep only trajectories ending in a passing check and tests, at most 3 per task.
- Order-of-magnitude targets from SWE-smith: about 500 trajectories gives meaningful gains, and about 2K–5K is where 7B–32B models were trained. Jac's edit/check loops are much shorter than SWE-bench tasks, so a few thousand trajectories is plausibly enough for a small model.
- Keep tool names and argument schemas identical to what the deployed agent harness exposes (for example the `jac mcp` names). Train on the harness's exact chat template.
- Mix plain code-SFT samples (Q3) with trajectories, so the model learns both syntax and the loop.

### Gaps
- I found no published Jac-specific agent-trajectory dataset.
- I did not read TRL / LLaMA-Factory or Qwen official tool-calling SFT docs directly.
- The SWE-smith scaling curve between 500 and 5K trajectories is only in a figure and was not captured.

---

## Q5. How many examples are needed, and data cleaning/dedup practices

### Takeaway
The evidence points to a **few thousand to about 25K verified, idiomatic examples** for strong syntax acquisition in a small model:
- Jaseci's Jac runs reached 10.5% → about 75% functional pass with 5.5K–8K SFT rows.
- Kotlin gained +16 points with 15K exercises.
- MultiPL-T used about 25K–48K per language and saw substantial gains after one epoch on 25K.

Quality, idiomaticity and mix beat volume (Kotlin KStack 3.1B tokens < KStack-clean 22M tokens < KExercises 15K; Jac exp08 14.8K < exp06 5.5K). Clean with exact-hash plus near-dedup, licence filtering, eval decontamination, and length guards.

### Cited Findings
- Jac (Qwen3-Coder-30B-A3B, LoRA): base 10.5% → 74.4% with **5,474** SFT rows (exp06), and 74.7% with **8,100** (exp04). **14,792** rows (exp08) scored lower at 70.5%. An early run "peaked at 61.1% with 20 examples". That note is ambiguous in the source; it probably refers to a 20-example eval or a few-shot setting, so treat it with caution. — [HISTORY.md](https://raw.githubusercontent.com/jaseci-labs/Jac_Model_Experiments/main/docs/HISTORY.md); [README](https://github.com/jaseci-labs/Jac_Model_Experiments)
- Kotlin: 15K synthetic exercises (+16.15 pass@1 on CodeLlama-7B) beat 25K curated files (+11.8), which beat 4M raw files (+3.1). — [arXiv 2405.19250](https://arxiv.org/html/2405.19250)
- MultiPL-T: about 37K–48K validated items per language. A balanced 25K/language ablation showed substantial Racket/OCaml gains after one epoch at 1B; Lua needed more. — [arXiv 2308.09895 HTML](https://arxiv.org/html/2308.09895v6)
- Magicoder: about 75K OSS-Instruct examples for ≤7B models (Python-centric, not low-resource). — [arXiv 2312.02120](https://arxiv.org/abs/2312.02120)
- Further pretraining on the target language gives the largest gains for no-resource languages. — [arXiv 2606.16827](https://arxiv.org/abs/2606.16827)
- **Cleaning practices (KStack)**:
  - Exact dedup by content hash, plus near-dedup as in The Stack v1.2, keeping one file per cluster (from the most-starred repo).
  - Permissive licences only (GitHub metadata plus go-license-detector).
  - PII filtering with a star-pii model.
  - Training filters: repo stars+forks ≥ 6, ≥ 5 files per repo, ≥ 20 SLOC, non-ASCII removal, 50% random drop of import lines.
  - An LLM-labelled quality classifier for the "clean" subset. — [arXiv 2405.19250](https://arxiv.org/html/2405.19250)
- **Jac-specific cleaning lessons**:
  - Eval-denylist (decontamination), test-count quality filter and licence filter (exp08).
  - Over-long prompts beyond `max_seq_length` caused silent NaNs (fixed with `nan_guard.jac`).
  - A holdout lacking a `messages` field silently "finished" eval in 30 s.
  - `mlx_lm.fuse` re-quantizing a 4-bit base erased the SFT delta.
  - No explicit dedup step was described. — [HISTORY.md](https://raw.githubusercontent.com/jaseci-labs/Jac_Model_Experiments/main/docs/HISTORY.md)
- The in-repo corpus has 41 exact-duplicate `.jac` groups (my md5 check). — [jaseci-labs/jaseci](https://github.com/jaseci-labs/jaseci)

### Inferences
- A suggested budget for a small (about 1.5B–8B) Jac model:
  - Optional continued pretraining on about 10M tokens of in-repo Jac plus docs.
  - **About 10K–25K verified SFT code samples**, balanced across function-level, OSP/walker, `by llm`, client/server app and migration/fix tasks.
  - **About 1K–5K agent trajectories**.
  - A few hundred to 1K DPO pairs (idiomatic vs transpile-shaped or legacy).
  - A held-out functional eval of about 500–1,000 tasks.

  These numbers are extrapolated from the cited ranges, not directly measured for Jac at small sizes.
- Smaller models (≤3B) probably need the upper end and more epochs. MultiPL-T's 1B used 7 epochs; Kotlin and MultiPL-T both trained 7B-class models on 15K–25K.
- Dedup: exact hash plus MinHash near-dup over normalized Jac (strip comments and whitespace). Pair `.jac` with `.impl.jac`. Remove compiler-fixture files that are expected to fail. Decontaminate against the eval set by n-gram overlap and by source-function id (MultiPL-T seeds overlap HumanEval/MBPP-like tasks).
- Re-validate everything with the pinned current compiler. Version drift (0.16 → 0.40) is the largest data-quality risk specific to Jac.

### Gaps
- I found no practitioner blog posts with controlled data-size sweeps for a brand-new DSL at the 1B–3B scale. The Jac evidence is on a 30B-A3B MoE, not a small dense model.
- LIMA-style "1K examples suffice" evidence is about general alignment, not new-language syntax, and was not fetched here.
- Whether `jac check` at 0.40 still "over-rejects idiomatic untyped Jac" (as reported at 0.16.x) is unverified. With type checking now mandatory, untyped code may simply be invalid.
