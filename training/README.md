# Training jaccode's own Jac model

**Fastest way:** [open `jaccode_pipeline.ipynb` in Google Colab](https://colab.research.google.com/github/hernandeztien51-crypto/Jaccode/blob/main/training/jaccode_pipeline.ipynb). It runs everything below on a free GPU and ends with
a before/after score:
1. Install Jac, Node and Ollama.
2. Check the benchmark against the real compiler.
3. Build verified data with Claude.
4. Fine-tune.
5. Compare the untrained and trained models.

The trial settings cost roughly $10–30 of Claude usage (an estimate) and take about 1–2 hours.

This folder builds a small Jac-specialised model, starting from Qwen3.5-2B (Apache 2.0), and ships it as a GGUF file
of about 1.4 GB. The result runs on a laptop with no API key and no per-token cost, through jaccode's Ollama provider.
The reasoning behind each choice is in `../reports/Custom small Jac coding model.md`.

Each step keeps only data the Jac compiler accepts, and the benchmark in `../evals/jac` measures the result.

| Step | Script | Needs | Output |
|---|---|---|---|
| 1. Corpus | `build_corpus.py` | a Jaseci checkout, `jac` | `data/corpus.jsonl` |
| 2. Translations | `translate.py` | Claude API key, `jac` | `data/translated.jsonl` |
| 3. Agent tasks | `make_agent_tasks.py` | `jac` | `data/agent_tasks/` |
| 4. Trajectories | `jaccode eval --tasks … --record` | Claude API key, `jac` | `data/runs.jsonl` |
| 5. Dataset | `prepare_sft.py` | — | `data/sft/{train,val,cpt}.jsonl` |
| 6. Fine-tune | `train_sft.py` | GPU, ~5 GB (free Colab T4 works) | LoRA + GGUF |
| 7. RL (optional) | `train_grpo.py` | GPU, `jac` | LoRA + GGUF |
| 8. Measure | `jaccode eval -m ollama:…`, then `compare.py` | `jac`, Ollama | pass@1, compile rate, side by side |

Steps 2 and 4 are the only ones that cost money, and only for the teacher model's tokens. The model you train
is free to run afterwards.

## 0. Setup

```bash
curl -fsSL https://raw.githubusercontent.com/jaseci-labs/jaseci/main/scripts/install.sh | bash   # jac 0.40+
git clone --depth 1 https://github.com/jaseci-labs/jaseci
pip install -r requirements.txt            # data steps; the GPU steps install Unsloth separately
cd .. && npm install && npm run build && cd training
```

Pin one `jac` version for the whole run. Every sample records the version it was verified with, and Jac's syntax
changed a lot during 2026.

## 1–5. Build the data

```bash
python build_corpus.py --jaseci jaseci --out data/corpus.jsonl --verify
python translate.py --mbpp --out data/translated.jsonl --workers 4            # add --limit 50 for a cheap first pass
python make_agent_tasks.py --translated data/translated.jsonl --out data/agent_tasks
node ../dist/cli.js eval --tasks data/agent_tasks --record data/runs.jsonl --quiet
python prepare_sft.py --translated data/translated.jsonl --runs data/runs.jsonl \
    --corpus data/corpus.jsonl --general HuggingFaceTB/smoltalk --out data/sft
```

- `translate.py` is resumable. Re-running it skips problems that are already done.
- Recorded runs on the benchmark tasks themselves (`evals/jac`) are always excluded from training.
- `--general` mixes in general chat data, 20% by default, so the model keeps its broader skills. Leave it out to
  train on Jac only.

Targets from the research: 10k–25k verified code samples and 1k–5k agent trajectories. A balanced mix matters more
than volume.

## 6. Fine-tune (GPU)

```bash
pip install --upgrade unsloth unsloth_zoo
python train_sft.py --data data/sft --out out/jac-2b                  # add --push you/jaccode-jac-2b-GGUF
```

- Defaults: 16-bit LoRA rank 32, learning rate 2e-4, 2 epochs, loss on assistant turns only.
- Exports `q5_k_m` (recommended), `q4_k_m` and `q8_0`.
- `--cpt` first adapts the model on the raw Jac corpus. Treat it as an experiment and keep it only if the benchmark
  improves.
- `--base unsloth/Qwen3.5-0.8B` gives a faster, smaller model. `--base unsloth/Qwen3.5-4B` gives a stronger one.

## 7. Reinforcement learning (optional, GPU)

```bash
python train_grpo.py --lora out/jac-2b/lora --problems data/translated.jsonl --out out/jac-2b-rl --pilot 300
```

- The reward is 1.0 only when `jac check` and the hidden tests pass.
- `--pilot` keeps problems the model solves 10–70% of the time, the only ones it can learn from.
- RL can get worse late in a run. Benchmark the saved checkpoints and keep the best, not just the last.

## 8. Use and measure it, no API key

```bash
ollama run hf.co/you/jaccode-jac-2b-GGUF:Q5_K_M                       # or `ollama create` from a local GGUF
node ../dist/cli.js -m ollama:hf.co/you/jaccode-jac-2b-GGUF:Q5_K_M     # use it in jaccode
node ../dist/cli.js eval -m ollama:hf.co/you/jaccode-jac-2b-GGUF:Q5_K_M --out results.json
```

Compare against the untrained base model (`-m ollama:hf.co/unsloth/Qwen3.5-2B-GGUF:Q5_K_M`) and against Claude. Report pass@1, compile rate
and foreign-syntax rate side by side.

## Expected results (estimates from the research, not measurements)

- **Code:** a fine-tuned 2B model should solve about 20–35% of tasks on a first try, with 80–95% of its code
  type-checking.
- **Agent work:** reliable on short edit, check and fix loops. Weaker on multi-file work.
- **Speed:** roughly 25–40 tokens/s on a laptop CPU.
- **For comparison:** Jaseci Labs' own 30B fine-tune went from 10.5% to 74.7% on their Jac test set.
