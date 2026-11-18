# Evaluating a small fine-tuned Jac coding model (incl. as a tool-calling agent), and realistic quality expectations

Research date: 2026-11-17. About 22 tool calls. Several arXiv sources were read at abstract level only; where a number came from a full-text read this is stated. Items from background knowledge that I did not re-check in this session are labelled "unverified" and kept out of the Cited Findings lists.

## 1. Building a benchmark for a new or low-resource language (MultiPL-E style), and porting HumanEval/MBPP to Jac with `jac check` / `jac run` / `jac test`

### Takeaway
The standard method is to translate test-driven Python benchmarks (HumanEval's 164 problems, MBPP) into the target language, then score with execution-based pass@1 from a sandbox that compiles and runs hidden tests. A Jac port of HumanEval with 164 tasks already exists in Jaseci Labs' JaseciBench, so it should be reused or mirrored, not rebuilt. Report compile rate (`jac check` exit code) next to pass@1, because for a new language most failures happen before any test runs.

### Cited Findings
- MultiPL-E (arXiv, Aug 2022, revised Dec 2022) is "a system for translating unit test-driven code generation benchmarks to new languages". It extends HumanEval and MBPP to 18 languages beyond Python and uses that range to study how language frequency and language features affect model performance. — [MultiPL-E, arXiv:2208.08227](https://arxiv.org/abs/2208.08227)
- MultiPL-T (2023, rev. Sep 2024) reports its results on MultiPL-E pass@1. This is the de facto metric for low-resource code languages. — [MultiPL-T, arXiv:2308.09895v6](https://arxiv.org/html/2308.09895v6)
- CangjieBench (Mar 2026) shows a recent recipe for a low-resource general-purpose language. It has 248 tasks: 164 HumanEval function-level and 84 ClassEval class-level, translated by hand from Python. Each sample is compiled and run against tests in a pinned Docker sandbox. Two authors reviewed the reference solutions and checked them against deliberately broken variants, so the tests "both accept the correct answer and reject common incorrect ones". Decoding was greedy, temperature 0, one sample per task. — [CangjieBench HTML](https://arxiv.org/html/2603.14501v2)
- In CangjieBench's Direct setting, pass@1 and compile rate are within about 3 pp of each other, so most failures happen before tests run. "Foreign syntax" (code written in another language's idioms) accounts for 83.9% (Text-to-Code) and 82.0% (Code-to-Code) of failed Direct samples. — [CangjieBench HTML](https://arxiv.org/html/2603.14501v2)
- A 2026 paper on "no-resource" languages built three new benchmarks for two recently proposed languages and evaluated prompting, further pre-training and fine-tuning. — [arXiv:2606.16827](https://arxiv.org/abs/2606.16827) (abstract only)
- Jac CLI exit-code semantics, from the official reference:
  - `jac check <paths>` type-checks. `-p/--parse_only` checks syntax only, and `--lint` also runs the linter. Diagnostics have codes such as `E1030`.
  - `jac run` treats errors as exit code 1 (`-e/--diagnostics error|all|none`), and `--entry <name>` runs a specific function or walker.
  - `jac test` runs tests through the bundled pytest, with `-t/--test_name`, `-f/--filter`, `-x` and `-m/--maxfail`.
  - `jac fmt --check` exits 1 when files are unformatted. `jac lint` has been removed in favour of `jac check --lint`.
  - `jac check`, `jac run` and `jac test` have no JSON output flags, so use exit codes and diagnostic codes instead.

  — [Jac CLI reference](https://docs.jaseci.org/reference/cli/)

### Inferences
- **Proposed Jac benchmark design ("JacEval"):**
  1. **Function-level tasks: Jac-HumanEval (164) plus Jac-MBPP (about 400 sanitized).** Port each task as:
     - a Jac function signature and docstring (the prompt);
     - a hidden test file with `test "..." { assert ... }` blocks, or a `with entry` harness that asserts and exits non-zero on failure;
     - a reference solution.

     Validate every task by checking that the reference passes (`jac test`) and that a few mutated or broken variants fail. This mirrors CangjieBench's broken-variant check.
  2. **Jac-specific tasks (about 50-150).** These cover features with no Python equivalent: `node` / `edge` / `walker` / `visit` / `spawn`, `obj` / `has` fields, `can ... with entry`, `by llm()` / `sem`, and `cl` / `sv` client-server code. HumanEval translations do not test Jac idioms, and a model can pass them by writing Python-flavoured Jac.
  3. **Metrics per task:**
     - parse rate (`jac check -p` exit 0);
     - type-check rate (`jac check` exit 0);
     - pass@1 (hidden tests pass), greedy, temperature 0, as CangjieBench does;
     - optionally pass@10 at T=0.8 for headroom.
  4. **"Foreign syntax" rate.** Classify failures with diagnostic codes plus simple regexes: Python `def`, missing braces or semicolons, `self.` in `obj`, `import x` vs `import from`. CangjieBench found this was the dominant failure for unfamiliar languages.
  5. **Sandboxing and pinning.** Pin the Jac version, since JaseciBench pins Jac 0.34.8 per app via `jac.toml`. Run each task in a container with timeouts. Jac syntax has changed across versions, so an unpinned eval will drift.
- **Contamination guard.** The Jac HumanEval port is public in JaseciBench, so if training data comes from Jaseci repos, de-duplicate against it or keep a held-out private split. JaseciBench itself keeps hidden tests in a private "vault" repo.
- **Background (unverified this session).** MultiPL-E translates only the function signature, the docstring/doctest prompt and the assert-style unit tests with per-language "translators". It drops problems whose types can't be translated, and the model's completion is concatenated with the tests and run. The same approach works for Jac because Jac is close to Python in types and expressions.

### Gaps
- I could not see how JaseciBench's Jac HumanEval was ported, how it is graded (`jac run` vs `jac test`), or any scores. Grading is in the private `JaseciBench-vault` repo and needs an eval token from a maintainer.
- I did not read the exact Jac test-block syntax section of the docs: the CLI page was truncated after 100k characters.

## 2. Evaluating agent behaviour (multi-step tool use, exact-string edits, fixing compiler errors) for small models

### Takeaway
Use a layered eval:
- **Static tool-call validity:** BFCL-style checks of JSON and schema validity.
- **Micro-agent tasks:** single-file edit or fix, graded by `jac check` / `jac test`.
- **Small SWE-style resolve-rate suite:** on a real Jaseci app. JaseciBench's CodeAgentEval layer (resolve rate) is the closest existing harness.

Log per-step process metrics as well. Small models fail mostly on process (invalid calls, repeated identical retries, `old_string` mismatches), not only on outcome.

### Cited Findings
- JaseciBench (Jaseci Labs, 2026) has three layers. "A multi-language, multi-layer benchmark suite for evaluating LLMs and coding agents on Jac and the Jaseci stack" that runs the same tasks across Jac, Python and other languages.
  - **ModelEval:** single inference, no agent loop, pass@1. It includes a Jac HumanEval port of 164 tasks.
  - **CodeAgentEval:** a full agent loop on a real Jaseci codebase, where the agent reads files, runs tests and iterates. Metric: `resolve_rate`. Currently `suite/agent/basic/calculator/` is a reference app with 3 agent tasks.
  - **AppAgentEval:** an agent ships an app from a spec. Metric: `composite / max`.

  Grading runs via `./scripts/grade` or a maintainer-triggered `grade-pr` workflow, with hidden tests in the private JaseciBench-vault. The repo shows 59 commits, 0 stars and no published leaderboard numbers. — [jaseci-labs/JaseciBench](https://github.com/jaseci-labs/JaseciBench); fork: [RavimalRanathunga/JaseciBench](https://github.com/RavimalRanathunga/JaseciBench)
- CangjieBench compared Direct, Syntax-Constrained (a roughly 2,146-token syntax reference in the prompt), RAG and Agent (CLI coding agents) settings. Agents got the best accuracy but at high token cost:
  - GPT-5 + Codex CLI used 391.7k tokens per task on HumanEval, vs 46.4k for Syntax-Constrained.
  - Qwen3-Coder + Qwen Code CLI used 221-248k tokens per task.
  - Repeated Syntax-Constrained sampling (pass@10) beat a matched single agent run on every backbone. For example, Kimi-K2 scored 84.1% vs 39.0% with iFlow CLI on HumanEval.

  — [CangjieBench HTML](https://arxiv.org/html/2603.14501v2)
- BFCL categories used for small-model tool-calling evaluation: simple, multiple, parallel, parallel-multiple and relevance detection, live and non-live, plus multi-turn. — [TinyLLM, arXiv:2511.22138](https://arxiv.org/abs/2511.22138)
- SWE-Gym (Dec 2024) is the reference design for training and evaluating open agents on executable repo tasks: 2,438 real Python task instances, each with a codebase, an executable runtime, unit tests and a task description. Fine-tuned agents gained up to 19% absolute resolve rate on SWE-bench Verified and Lite, reaching 32.0% Verified and 26.0% Lite with verifiers. — [SWE-Gym, arXiv:2412.21139](https://arxiv.org/abs/2412.21139) (abstract only)
- A pre-registered 2026 study of SLMs as "microtask" components in agent harnesses found that 0/16 Qwen3 configurations (0.6B, 1.7B, 4B, 8B) and 0/12 Llama-3.x configurations met the CI-aware eligibility threshold. The result held across prompt paraphrases (0/112) and 4-bit quantization. The authors recommend placing an SLM behind a non-LLM baseline. — [arXiv:2610.00025](https://arxiv.org/abs/2610.00025) (abstract only)
- A blog survey of tiny tool-calling models says small models tend to either retry identically or give up when tools fail. This is weak evidence (blog). — [5 Tiny Language Models for Tool Calling (Part 3)](https://ai.plainenglish.io/5-tiny-language-models-for-tool-calling-part-3-ebcda32c2518)

### Inferences
- **Proposed agent eval for jaccode.** jaccode's tools are `read_file`, `write_file`, `edit_file` (exact `old_string` / `new_string`, must be unique unless `replace_all`), `multi_edit`, `list_dir`, `glob`, `grep`, `bash`, `jac` and `todo_write`. Measure the following, from the local repo source in `/home/user/jaccode/src/tools/`:
  - **Tool-call validity rate:** the share of model turns whose tool call parses and validates against the zod schema (unknown tool, bad JSON, missing field, wrong type).
  - **Edit-application rate:** the share of `edit_file` / `multi_edit` calls that apply cleanly, with the failure reasons "not found" vs "occurs N times" broken out. Both errors are already produced by the tool (`files.ts` lines ~115-131), so this is cheap to log.
  - **Fix-the-compiler-error tasks:** a seeded broken `.jac` file plus the `jac check` output. Success means `jac check` exits 0 and the hidden `jac test` passes within ≤N turns. Report the turns-to-green distribution.
  - **Multi-step tasks:** for example, "add a walker and a test". Score resolve rate with hidden tests, as JaseciBench CodeAgentEval does.
  - **Process failure taxonomy:** identical-retry loops (same call repeated), give-ups, hallucinated files or paths, editing without reading first, never running `jac check`, and exceeding the context limit.
  - **Cost:** tokens and wall-clock per solved task, because CangjieBench shows agent loops can cost 10x the tokens of a single-shot prompt.
- **Suite size.** About 30-60 micro-agent tasks plus 10-20 repo tasks across 2-3 small Jaseci apps (calculator-style, graph or walker app, client/server app). Run 3 seeds per task, because small-model agent runs have high variance.
- **Adaptable harnesses (background, unverified this session).** mini-SWE-agent / SWE-agent and OpenHands provide SWE-bench-style loops. Aider's edit-format benchmarks measure whether edits apply. BFCL measures function-call AST validity. Running jaccode's own loop with a mock or ollama provider (`src/providers/mock.ts`, `ollama.ts`) is probably simplest, since it tests the real tool schemas and prompts.

### Gaps
- I did not find a published small-model (≤3B) SWE-bench Verified score. Search returned only model-card claims, such as smolcode-coder-1.5B "7 out of 10 tasks" on its own eval ([featherless listing](https://featherless.ai/models/seanpoyner/smolcode-coder-1.5b-tools)), which is self-reported and not comparable.
- I did not read the full papers for SWE-Gym model-size breakdowns (7B/14B/32B) or for loop and stuck-repetition statistics.

## 3. How much fine-tuning helps small models on low-resource languages; pass@1 levels at 1B-3B

### Takeaway
Fine-tuning on validated, translated, test-checked data roughly doubles to sextuples pass@1 at 1B for very low-resource languages. In MultiPL-T, StarCoderBase-1B went from 1.5% to 9.7% (OCaml) and from 4.7% to 11.3% (Racket), about matching the untuned 15B. The absolute ceiling at 1B in that 2023-24 work is still only about 10-17%. Raw in-language code from The Stack helped little or even hurt. Modern 1.5-3B coder bases are much stronger on Python (Qwen2.5-Coder-1.5B/3B: 43.9/52.4 HumanEval), so a fine-tuned 1.5-3B Jac model plausibly lands well above MultiPL-T's 1B numbers. Expect Jac pass@1 to stay clearly below the same model's Python pass@1.

### Cited Findings
- MultiPL-T, full-text table: MultiPL-E pass@1 before → after fine-tuning on MultiPL-T data. — [MultiPL-T HTML v6](https://arxiv.org/html/2308.09895v6)

  | Language | StarCoderBase-1B | StarCoderBase-15B | Code Llama 34B | Code Llama 70B |
  |---|---|---|---|---|
  | OCaml | 1.5 → 9.7 | 6.9 → 19.9 | 18.3 → 27.4 | 23.2 → 29.3 |
  | Racket | 4.7 → 11.3 | 11.8 → 21.0 | 15.9 → 29.1 | 21.9 → 33.1 |
  | R | 5.4 → 8.9 | 10.2 → 17.3 | 18.2 → 25.5 | 23.0 → 28.5 |
  | Julia | 11.3 → 15.6 | 21.1 → 35.2 | 31.8 → 43.5 | 41.9 → 44.5 |
  | Lua | 12.1 → 17.3 | 26.6 → 31.0 | 38.1 → 43.9 | 41.7 → 44.9 |
- MultiPL-T data, from the same source:
  - **Pipeline:** an LLM generates tests for commented Python code; faulty or low-coverage tests are filtered; Python is translated into the target language; each translation is validated by those tests.
  - **Size:** about 37.6k-48.2k validated items per language (R 37,592; Racket 40,510; OCaml 43,401; Julia 45,000; Lua 48,194). Ablations used 25k per language.
  - **Training:** 1B for 7 epochs, larger models for 10. The best epoch was reported.
  - **Where gains are largest:** in the lowest-resource languages (Racket, OCaml), where 1B fine-tuned ≈ 15B base.
  - **Natural code:** training on natural code from The Stack "barely increases" performance for Racket and OCaml and "even decreases" it for Lua. Training longer on low-resource data "is not only inefficient, but can actually hurt performance."

  — [MultiPL-T HTML v6](https://arxiv.org/html/2308.09895v6)
- Qwen2.5-Coder base models, HumanEval / HumanEval+ / MBPP: 0.5B 28.0 / 23.8 / 52.9; 1.5B 43.9 / 36.6 / 69.2; 3B 52.4 / 42.7 / 72.2. These are Python baselines for candidate base models. — [Qwen2.5-Coder Technical Report, arXiv:2409.12186](https://arxiv.org/pdf/2409.12186) (numbers via search snippet of the report's table)
- On "no-resource" languages (2026), further pre-training on the target language gave the largest gains. Applying it directly to an instruct model hurt instruction-following. The fix is to continue pre-training the base model, then restore instruction-following by weight-diff transfer from the instruct model. — [arXiv:2606.16827](https://arxiv.org/abs/2606.16827) (abstract only, no numbers seen)
- CangjieBench: frontier models (>200B) get only 4.8% (GPT-5) and 15.3% (Kimi-K2) Direct pass@1 on an unseen language. That rises to 50.4% (GPT-5) with a syntax reference in the prompt and 66.9% with an agent (Codex CLI). Models under 200B "bottomed out at near-zero Pass@1 in pilot runs" and were excluded. — [CangjieBench HTML](https://arxiv.org/html/2603.14501v2)
- Other 2026 low-resource and DSL fine-tuning work exists but was not read in detail:
  - Julia via test-time-compute-curated data: [Selective Left-Shift, arXiv:2607.07748](https://www.alphaxiv.org/abs/2607.07748)
  - Pharo code completion: [arXiv:2607.04939](https://www.alphaxiv.org/abs/2607.04939)
  - MiniZinc SLM fine-tuning: [Learn2Zinc, arXiv:2607.20456](https://www.alphaxiv.org/abs/2607.20456)
  - SLM fine-tuning for production DSL code: [arXiv:2604.09952](https://www.alphaxiv.org/abs/2604.09952)
  - RL from verification feedback for small code models: [arXiv:2605.30478](https://www.alphaxiv.org/abs/2605.30478)

### Inferences
- **Realistic targets for a fine-tuned 1.5-3B Jac model on Jac-HumanEval (greedy pass@1).** These are an estimate, not a measured result.
  - Untuned small models will likely be near zero, as CangjieBench found for models under 200B on Cangjie without help.
  - A well-fine-tuned 1.5B might reach roughly 20-35% and a 3B roughly 30-45%, below their Python scores of 43.9 and 52.4.
  - 0.5B is likely at most about 10-20%.
  - The reasoning: Jac shares Python's semantics and standard library, so it should behave more like a "close cousin" language with Python-shaped data than like Racket or OCaml. Most of the gap should be syntax, which fine-tuning fixes well. Algorithmic ability is capped by the base model's Python skill.
- **Compile rate should move much more than pass@1.** Expect type-check pass rates of 80-95% after fine-tuning if the training data is checked with `jac check`.
- **Data recipe implied by MultiPL-T.** Generate tens of thousands of Python → Jac translations from a strong model, validated by running tests with `jac test`, rather than scraping the small amount of public Jac code. Train for a few epochs and pick the best checkpoint by Jac-HumanEval or a held-out split. Use the 2026 finding: continue pre-training on Jac code and docs on the base model, then apply SFT or instruct weight-diff, instead of only SFT on an instruct model.
- **Jac-specific (OSP / walker) tasks will score lower** than HumanEval-style tasks, because translated-from-Python data does not cover them.

### Gaps
- MultiPL-T MBPP numbers and its StarCoder2/DeepSeek-Coder follow-ups were not retrieved. These are in the supplementary material, which I did not read.
- No published Julia, Verilog or DSL pass@1 numbers at exactly 1-3B were retrieved with full text. The Verilog papers found ([arXiv:2608.22938](https://www.alphaxiv.org/abs/2608.22938), [arXiv:2605.26498](https://www.alphaxiv.org/abs/2605.26498)) were seen as titles and abstracts only.
- Qwen2.5-Coder small-model MultiPL-E per-language numbers were not retrieved.

## 4. Known limits of 0.5B-3B models as coding agents; value of grammar-constrained decoding and compiler-feedback loops

### Takeaway
Sub-1B models are clearly weaker than 1-3B at tool calling. Even 1-3B models top out around 65% BFCL overall and 55% multi-turn after optimization. Off-the-shelf SLMs up to 8B failed every pre-registered agent-microtask eligibility test. Expect a fine-tuned 1.5-3B Jac agent to handle short, well-scoped loops (one-file fix with compiler errors, add a function and a test) but not open-ended multi-file tasks. Syntax or grammar help and compiler feedback are the highest-leverage aids:
- Putting syntax guidance in the prompt raised frontier pass@1 on an unseen language 5-10x.
- Type-constrained decoding more than halved compile errors.
- Compiler feedback during generation beats post-hoc repair.

### Cited Findings
- TinyLLM (Nov 2025, BFCL): 1-3B models "clearly outperform" sub-1B models. The best results were up to 65.74% overall and 55.62% multi-turn accuracy, with hybrid optimization. — [TinyLLM, arXiv:2511.22138](https://arxiv.org/abs/2511.22138) (abstract only)
- Qwen3 0.6B-8B and Llama-3.x SLMs: 0/16 and 0/12 configurations eligible for agent microtasks. Quantization did not change eligibility, and "the gap tracks model size more than precision." — [arXiv:2610.00025](https://arxiv.org/abs/2610.00025) (abstract only)
- Syntax-constrained prompting (a compact syntax reference) gave "the best balance of accuracy and computational cost" on an unseen language. GPT-5 Text-to-Code rose from 4.8% to 50.4%, and foreign-syntax failures fell from about 84% to about 30%. RAG over docs or code helped less: GPT-5 averaged 25.2% (docs) and 33.7% (code) vs 44.2% syntax-constrained. — [CangjieBench HTML](https://arxiv.org/html/2603.14501v2)
- Type-constrained decoding (prefix automata plus type-inhabitation search, extended to TypeScript; Apr/May 2025) "reduces compilation errors by more than half" on HumanEval and MBPP. It significantly improves functional correctness across synthesis, translation and repair, for models of various sizes including more than 30B. — [Type-Constrained Code Generation, arXiv:2504.09246](https://arxiv.org/abs/2504.09246) (abstract only)
- Generative compilation (Jul 2026) checks partial programs during generation using a "sealor" that completes partial programs for the compiler. On repo-level Rust it reduces non-compiling outputs and improves functional correctness compared with standard post-generation compiler feedback. The paper notes that constrained decoding needs white-box model access and costly reimplementation for semantic constraints. — [arXiv:2607.13921](https://arxiv.org/abs/2607.13921) (abstract only, no numbers seen)
- A 2026 study on DSL generation finds grammar/metamodel-guided decoding improves consistency. — [arXiv:2610.29749](https://www.alphaxiv.org/abs/2610.29749) (title and abstract snippet only)
- Small models tend to retry identically or give up after tool failures. This is a blog-level claim. — [5 Tiny Language Models for Tool Calling (Part 3)](https://ai.plainenglish.io/5-tiny-language-models-for-tool-calling-part-3-ebcda32c2518)
- Jac's own agent `jac ai` supports local models (`-m local:gemma-4-e4b`) and has a `-n/--n_ctx` context-window flag for local models. Context window is treated as a first-class constraint for local agents. — [Jac CLI reference](https://docs.jaseci.org/reference/cli/)

### Inferences
- **Context length.** jaccode's system prompt, tool schemas and file reads probably consume several thousand tokens before any work starts. 0.5-3B models degrade on long contexts, so the eval should include a context-budget condition, such as 8k vs 32k. Agent design should favour short tool outputs (truncated `jac check` errors, line-ranged reads).
- **Highest-value interventions for a small Jac agent, in likely order of payoff per effort:**
  1. An automatic `jac check` after every edit, with errors fed back. This is cheap and works with any backend, including Ollama.
  2. A compact Jac syntax "cheat sheet" in the system prompt, by analogy with CangjieBench's biggest single gain.
  3. Schema- or JSON-constrained decoding of tool calls (Ollama structured outputs or GBNF) to push tool-call validity close to 100%.
  4. Full Jac-grammar-constrained decoding. This is the costliest, because it needs a Jac grammar in GBNF/Lark form and white-box decoding.
- **Ablations to run.** Measure each intervention as an ablation in the eval (on/off) so its value is measured, not assumed.
- **Sampling plus verification.** Since pass@10 with syntax help beat single agent runs, sampling k candidates and filtering by `jac check` / `jac test` may outperform a small model's multi-turn agent loop for function-level tasks.

### Gaps
- I did not retrieve numbers on how much compiler-feedback repair loops help specifically at 0.5-3B, nor SynCode / grammar-constrained decoding numbers for small models. These need full-text reads.
- I found no peer-reviewed SWE-bench-style resolve rates for 1-3B agents.

## 5. Existing Jac benchmarks or evals from Jaseci Labs

### Takeaway
Yes. Jaseci Labs has JaseciBench (2026), with a Jac HumanEval port (164 tasks), a coding-agent layer (resolve rate; currently 3 calculator-app tasks) and an app-building layer. No public scores were visible, and grading uses a private vault. There is a `jac-coder` PyPI package, but it is an agent backend, not a fine-tuned model. I found no published fine-tuned Jac model or Jac LLM leaderboard numbers.

### Cited Findings
- JaseciBench details (layers, 164-task Jac HumanEval port, 3 agent tasks, private vault, `./scripts/grade` with `JASECIBENCH_EVAL_TOKEN`, Jac 0.34.8 pinned per app, MIT license, 59 commits, no visible scores, no mention of fine-tuned or small models). — [jaseci-labs/JaseciBench](https://github.com/jaseci-labs/JaseciBench)
- The `jac-coder` package on PyPI is described as an AI coding agent backend for Jac, "powered by jac-byllm". Versions run from about 0.1.4 to 0.2.4, with no model weights or benchmarks. — [PyPI jac-coder](https://pypi.org/project/jac-coder/); [0.1.7](https://pypi.org/project/jac-coder/0.1.7/)
- The Jac toolchain ships:
  - `jac ai`, an interactive or one-shot coding agent with local-model support;
  - `jac model`, which manages local weights in `~/.cache/jac/models/`;
  - `jac mcp`, an MCP server with `lite` / `standard` / `full` modes and `--inspect` to list its tools. Per search summaries of the docs, it helps assistants "write, validate, format, and debug Jac code".

  — [Jac CLI reference](https://docs.jaseci.org/reference/cli/); [docs.jaseci.org llms.txt](https://docs.jaseci.org/llms.txt)
- The Jaseci group's published LLM-related research (MTP / `by llm()`) compares against hand-built prompt pipelines. It is not a code-generation benchmark. — [docs research page via search](https://docs.jaseci.org/community/research/); [xenospectrum analysis](https://xenospectrum.com/en/jac-language-ai-agents-jaseci-analysis/)

### Inferences
- **Reuse JaseciBench.** Use its HumanEval port and agent-task format for comparability with Jaseci Labs. Contact the maintainers for an eval token or vault access. Build a local, open "dev" version of the suite for fast iteration, since vault grading is remote and gated.
- **Version mismatch to resolve before building any eval or training set.** JaseciBench pins Jac 0.34.8, installed as a native binary, and says Jac is not installed from PyPI. The jaccode README says `pip install jaclang` and shows "jac 0.8.x".
- **Use `jac mcp --inspect` as a tool inventory.** Its validate and format tools could be mirrored as agent tools, or used as the eval's checker.

### Gaps
- JaseciBench scores, porting method and grading commands could not be seen (private vault).
- I found no evidence of Jac-specific LLM fine-tuning by Jaseci Labs, or of how `jac ai` models are evaluated internally.
