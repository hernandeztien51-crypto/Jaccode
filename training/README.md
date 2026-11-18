# Training jaccode's own Jac model, free

This folder trains a small Jac-specialised model, starting from Qwen3.5-2B (Apache 2.0), and ships it as a GGUF file
of about 1.4 GB. It runs on a laptop through Ollama, with no API key and no per-token cost. Building it costs
nothing either: the teacher is a free open model and the training runs on Colab's free GPU.

**Fastest way:** [open `jaccode_pipeline.ipynb` in Google Colab](https://colab.research.google.com/github/hernandeztien51-crypto/Jaccode/blob/main/training/jaccode_pipeline.ipynb),
pick a T4 GPU, then Run all. It saves progress to your Google Drive and ends with a before/after score.

## How it stays correct without a paid teacher

The teacher's answers don't need to be trusted:
- **The real compiler checks everything.** Every solution must pass `jac check` and the problem's tests, or it's
  thrown away. A weaker free teacher just yields fewer kept problems, not wrong ones.
- **The tests are mechanical.** MBPP's Python `assert` lines are converted to Jac `test` blocks without any model
  (`translate.asserts_to_jac`), so a model can't write tests that happen to agree with its own mistakes.
- **Compiler feedback and resampling.** A failed answer goes back to the teacher with the compiler's errors, and
  several independent samples are drawn per problem.
- **Self-improvement (round 2).** Once trained, the student attempts more problems itself, and only its verified
  answers are added. This is the expert-iteration loop: compiler-checked self-training, at no cost.

## Steps

| Step | Script | Output |
|---|---|---|
| 1. Corpus | `build_corpus.py` | `data/corpus.jsonl`: Jac from Jaseci's examples, docs and guides |
| 2. Verified solutions | `translate.py` (teacher: `ollama:…` free, or `claude:…`) | `data/translated.jsonl` |
| 3. Agent tasks | `make_agent_tasks.py` | `data/agent_tasks/`: write, port, fix syntax, fix bug |
| 4. Trajectories | `jaccode eval --tasks … -m ollama:<teacher> --record` | `data/runs.jsonl`: only passing runs are used |
| 5. Dataset | `prepare_sft.py` | `data/sft/{train,val,cpt}.jsonl` |
| 6. Fine-tune | `train_sft.py` | LoRA + GGUF |
| 7. RL (optional) | `train_grpo.py`: reward = the compiler and tests pass | LoRA + GGUF |
| 8. Measure | `jaccode eval -m ollama:…`, then `compare.py` | pass@1, compile rate, top errors, side by side |

## Running it yourself

```bash
curl -fsSL https://raw.githubusercontent.com/jaseci-labs/jaseci/main/scripts/install.sh | bash   # jac 0.40+
git clone --depth 1 https://github.com/jaseci-labs/jaseci
pip install -r requirements.txt
ollama serve & ollama pull hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M           # the free teacher

python build_corpus.py --jaseci jaseci --out data/corpus.jsonl --verify
python translate.py --mbpp --limit 200 --out data/translated.jsonl
python make_agent_tasks.py --translated data/translated.jsonl --out data/agent_tasks
node ../dist/cli.js eval --tasks data/agent_tasks --limit 40 -m ollama:hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M --record data/runs.jsonl
python prepare_sft.py --translated data/translated.jsonl --runs data/runs.jsonl --corpus data/corpus.jsonl \
    --general HuggingFaceTB/smoltalk --general-config all --out data/sft
pip install --upgrade unsloth unsloth_zoo                                   # needs an NVIDIA GPU (~5 GB)
python train_sft.py --data data/sft --out out/jac-2b
```

Notes:
- `translate.py` is resumable. It skips problems that are already solved, so round 2 is just another run with
  `--teacher ollama:<your trained model>`.
- Recorded runs on the benchmark tasks themselves are always excluded from training.
- Pin one `jac` version for the whole run. Each sample records the version it was verified with.
- `--base unsloth/Qwen3.5-0.8B` gives a faster, smaller model. `--base unsloth/Qwen3.5-4B` gives a smarter one,
  if your GPU has about 10 GB.

## Expected results (estimates from the research, not measurements)

- **Code:** a fine-tuned 2B model should solve about 20–35% of benchmark tasks on a first try, with 80–95% of its
  code type-checking.
- **More data and round 2:** both push these numbers up. The 4B base pushes them higher still.
- **Speed:** roughly 25–40 tokens/s on a laptop CPU.
- **For comparison:** Jaseci Labs' own 30B fine-tune went from 10.5% to 74.7% on their Jac test set.
