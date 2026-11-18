# Fine-tuning a 0.5B-3B open-weight model into a single-language coding assistant (state as of Nov 2026)

Scope: practical SFT and optional RL (compiler/test reward) recipes for a small model specialised in one low-resource language (target: Jac), on a single consumer GPU or a free/cheap notebook. Research date: 2026-11-17. Prices and versions are dated where the source gave a date.

## Tooling: Unsloth, TRL (SFT/GRPO/DPO), Axolotl, LLaMA-Factory, torchtune. Which is easiest for a solo developer, and which export to GGUF?

### Takeaway
For one developer on one GPU or a Colab/Kaggle notebook, Unsloth (which wraps TRL's trainers) is the default choice. It has free T4 notebooks, the lowest VRAM use, GRPO support and one-call GGUF export (`save_pretrained_gguf` / `push_to_hub_gguf`). Use plain TRL when you want full control of GRPO (custom reward functions, vLLM server mode). LLaMA-Factory suits people who want a web UI. Axolotl is YAML-driven and leans toward multi-GPU. torchtune has been wound down and should not be used for new work.

### Cited Findings
- Unsloth exports GGUF directly with `model.save_pretrained_gguf("dir", tokenizer, quantization_method="q4_k_m")` and `model.push_to_hub_gguf(...)`. Methods include f16, q8_0, q4_k_m (recommended), q5_k_m and q6_k. The manual route is `save_pretrained_merged(..., save_method="merged_16bit")` followed by llama.cpp `convert_hf_to_gguf.py`. If GGUF saving runs out of memory, lower `maximum_memory_usage` (default 0.75) — [Unsloth docs: Saving to GGUF](https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf)
- The same page warns that bad outputs in Ollama or llama.cpp usually come from a wrong chat template, EOS token or BOS handling. Use the same chat template as in training — [Unsloth docs: Saving to GGUF](https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf)
- Unsloth requirements (page undated, current in late 2026):
  - GPUs: NVIDIA with CUDA capability 7.0 or higher (V100, T4, RTX 20–50, A100, H100, L40). GTX 1070/1080 work but are slow. P100 is not listed; it is capability 6.0, so check before relying on it.
  - Software: Python 3.11–3.13 for training. Linux, Windows (Unsloth Studio, no WSL needed) and macOS (training via MLX). Docker image `unsloth/unsloth`.
  - Source: [Unsloth requirements](https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements)
- TRL GRPOTrainer (docs `main` branch, late 2026):
  - Defaults: `num_generations=8`, `max_completion_length=512`, `beta=0.0` (no reference model is loaded), `loss_type="dapo"` (alternatives dr_grpo, sapo, cispo, vespo), `learning_rate=1e-6`.
  - vLLM: `use_vllm=True` in "colocate" mode (shares the GPU, `vllm_gpu_memory_utilization` default 0.3) or "server" mode (separate GPUs).
  - LoRA/QLoRA: via `peft_config` plus `quantization_config`.
  - Rewards: plain Python functions `reward_func(completions, **kwargs) -> list[float]`, sync or async. Multiple reward functions are summed. Dataset columns such as tests are passed in as kwargs.
  - Source: [TRL GRPOTrainer docs](https://huggingface.co/docs/trl/main/en/grpo_trainer)
- torchtune's README says it is "no longer actively maintained" and that development wound down in 2025 (see the "The future of torchtune" issue #2883). One directory lists the last release as v0.6.1 (7 Apr 2025) — [torchtune README](https://raw.githubusercontent.com/meta-pytorch/torchtune/main/README.md); [everydev.ai listing](https://www.everydev.ai/tools/torchtune)
- A July 2026 framework comparison reports on release activity:
  - Unsloth ships releases several times a week.
  - Axolotl released about twice in the previous 90 days.
  - LLaMA-Factory had no release in that window (last release 30 May 2026).
  - LLaMA-Factory can use Unsloth as a backend. In one quoted benchmark this matched Unsloth (~3.4 h) versus ~5 h without it. The article itself warns that such benchmark numbers get copied between sites without checking.
  - Source: [MarkTechPost, 22 Jul 2026](https://www.marktechpost.com/2026/07/22/unsloth-vs-axolotl-vs-trl-vs-llama-factory-a-fine-tuning-framework-comparison-on-speed-vram-and-multi-gpu/) and comparison summaries at [local-llm.net](https://www.local-llm.net/compare/unsloth-vs-axolotl-vs-llama-factory/) (secondary sources)
- Axolotl's output is a LoRA adapter, which you merge (`axolotl merge`) and then convert to GGUF via llama.cpp. No one-call GGUF export was reported — [local-llm.net Axolotl page](https://www.local-llm.net/tools/axolotl/) (secondary)

### Inferences
- Recommended stack: Unsloth `FastLanguageModel` + TRL `SFTTrainer` for SFT, then Unsloth or TRL `GRPOTrainer` for RL, then `save_pretrained_gguf(q4_k_m or q8_0)`. For a 0.5B–1.5B model, prefer q8_0 or q6_k, because small models lose relatively more quality under 4-bit quantization (this is a general rule of thumb, not a sourced benchmark).
- DPOTrainer is optional. If you can generate pairs (compiles and passes tests vs fails), DPO is a cheaper offline alternative to online GRPO, but GRPO with a live compiler gives fresher signal.

### Gaps
- I found no authoritative 2026 head-to-head benchmark of these frameworks on a 1.5B model. The comparison blogs are secondary sources and repeat each other.
- I did not verify LLaMA-Factory's current GGUF export path. Older versions exported merged HF weights, which then needed llama.cpp conversion.
- I did not check exact current version numbers for Unsloth or TRL; the docs pages give none.

## LoRA vs QLoRA vs full fine-tuning for 0.5B-3B: VRAM, hyperparameters, quality. Is continued pretraining on raw code worthwhile?

### Takeaway
At 0.5B–3B, VRAM is rarely the constraint: 16-bit LoRA on a 3B model needs about 8 GB and QLoRA about 3.5 GB. Use 16-bit LoRA when the GPU allows it, as it is slightly more accurate and faster than QLoRA. Fall back to QLoRA on a T4. Full fine-tuning of 0.5–1.5B is feasible on 24 GB, and learns a new domain better but forgets more. For a language that barely appears in pretraining data (Jac), a light continued-pretraining (CPT) pass on raw Jac code and docs is reasonable. The strongest evidence, though, is for large volumes of validated synthetic or translated instruction data (MultiPL-T) and for RL with execution feedback.

### Cited Findings
- Unsloth's minimum VRAM figures: 3B needs 3.5 GB with QLoRA and 8 GB with 16-bit LoRA. 16-bit LoRA uses about 4x the VRAM of QLoRA but is "slightly faster and more accurate" — [Unsloth requirements](https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements); [Unsloth LoRA hyperparameters guide](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide/lora-hyperparameters-guide)
- Unsloth's recommended starting hyperparameters:

  | Setting | Recommendation |
  |---|---|
  | Rank `r` | 16 or 32 (range 8–128) |
  | `lora_alpha` | equal to r or 2r |
  | Learning rate | 2e-4 for LoRA/QLoRA SFT; 5e-6 for RL (DPO/GRPO); lower for full fine-tuning |
  | Epochs | 1–3 |
  | Batch | 2 × grad_accum 8 = effective 16 |
  | Target modules | all 7 linear projections (q, k, v, o, gate, up, down) |
  | Dropout | 0 |
  | Weight decay | 0.01–0.1 |
  | Warmup | 5–10% of steps |
  | Scheduler | linear or cosine |
  | `train_on_responses_only` | on (QLoRA paper: about 1% gain) |
  | Overfitting signal | training loss below 0.2 |

  Source: [Unsloth LoRA hyperparameters guide](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide/lora-hyperparameters-guide)
- Unsloth's CPT advice:
  - CPT is for "new languages or domains" the base model saw too little of.
  - Add `embed_tokens` and `lm_head` to the LoRA target modules.
  - Give those two a 2–10x smaller learning rate (example: `learning_rate=5e-5`, `embedding_learning_rate=5e-6`; example uses r=16, alpha=16).
  - Source: [Unsloth continued pretraining docs](https://unsloth.ai/docs/basics/continued-pretraining)
- "LoRA Learns Less and Forgets Less" (Biderman et al., arXiv 2405.09673, TMLR):
  - In code CPT (StarCoder-Python) and code instruction tuning, LoRA clearly underperforms full fine-tuning, and higher ranks do not close the gap.
  - LoRA keeps more of the model's non-target abilities and more diverse HumanEval solutions.
  - Full fine-tuning learns weight changes of 10–100x higher rank than typical LoRA configs.
  - Source: [arXiv 2405.09673](https://arxiv.org/html/2405.09673v2)
- MultiPL-T (Cassano et al., OOPSLA 2024, arXiv 2308.09895):
  - Pipeline: an LLM writes tests for commented Python code, another translates the code into the low-resource language, and translations that fail the compiled tests are dropped. This produced tens of thousands of validated items each for Julia, Lua, OCaml, R and Racket.
  - Fine-tuning on this data "often more than doubl[ed]" pass@1 for OCaml and Racket, including at the 1B scale (StarCoderBase-1B).
  - It was more efficient than simply training longer on the scarce native code. The authors note that plain LLM-generated synthetic data in a low-resource language tends to be poor quality, which is why they used test-filtered translation.
  - Source: [arXiv 2308.09895](https://arxiv.org/html/2308.09895v6); [project page](https://ccs.neu.edu/~arjunguha/main/papers/cassano-multipl-t.html)

### Inferences
- Suggested recipe for Jac:
  1. **Optional CPT.** One or two epochs of LoRA at r=64–128, with `embed_tokens`/`lm_head` trained at a lower LR, on all available raw Jac (language docs, examples, the compiler's test suite, the standard library). This only pays off if there are at least a few million tokens. With less, fold the raw code into SFT as "explain/complete this file" tasks instead.
  2. **SFT.** 10k–50k instruction pairs, with r=16–32, LR 1e-4–2e-4, 1–3 epochs, responses-only loss. Most of the pairs should be generated Python→Jac translations and synthetic tasks filtered by the Jac compiler (`jac check`/run) plus tests, MultiPL-T style.
  3. **Optional GRPO.** See the next section.
- Full fine-tuning of 0.5B–1.5B in bf16 with 8-bit Adam fits in roughly 12–24 GB, by rough estimate (weights + grads + optimizer about 8–12 bytes/param, plus activations). It is worth considering if the evaluation shows LoRA underfitting the new syntax. In that case, mix general data back in to limit forgetting.

### Gaps
- I found no study that measures CPT-before-SFT specifically for a brand-new language at 0.5–3B scale. The benefit for Jac is inferred, not demonstrated.
- I found no sourced VRAM numbers for full fine-tuning of a 1.5B model on a T4. The figure above is an estimate.

## RL with verifiable rewards for code (GRPO/RLVR) using compile/test success: compute needs and reported gains at small scale

### Takeaway
GRPO with a compiler/test reward is a proven way to adapt models to low-resource languages, and it beat distillation from a frontier model in one study. Below about 1.5–2B parameters, though, results are mixed: gains appear only when the task difficulty matches what the model can already do sometimes. GRPO is far more expensive than SFT because rollout generation dominates; published runs used a 48 GB card up to 4–8 H100s for tens of hours. For Jac, do SFT first so the base pass rate is not near zero, then run a short LoRA GRPO stage on easy-to-medium problems.

### Cited Findings
- **Agnostics** (arXiv 2508.04865; Lua, Julia, R, OCaml, Fortran):
  - Setup: GRPO, reward 1 only if all I/O tests pass, AdamW LR 5e-6 with cosine schedule, 4 prompts per batch, group size 32, temperature 0.7, no KL term, sandboxed execution.
  - Results, Qwen3-4B on Ag-LiveCodeBench-X pass@1: Lua 11→23, Julia 10→22, R 10→15, OCaml 1→7, Fortran 0→15. The 4B and 8B models then matched or beat 16B DeepSeek-Coder-V2-Lite.
  - Supervised fine-tuning on 1,987 Sonnet-4 Fortran solutions (~$96 of generation) reached only 2–3%, versus 15% from RL.
  - Qwen3-1.7B and Llama-3.2-3B did NOT improve on the Codeforces-derived set (probably too hard for them).
  - Partial-credit rewards were tried and dropped because models exploited them (empty programs, hard-coded public tests).
  - Compute: training ran on 4x or 8x H100 nodes. Sweep runs on a 4B model took about 12 h (group 32) and about 20.5 h (group 64).
  - Setup cost: about 1 hour per language via a 4–5-line YAML config.
  - Source: [arXiv 2508.04865](https://arxiv.org/html/2508.04865v2)
- **nilenso OCaml experiment** (blog, 18 May 2026):
  - Setup: Qwen2.5-Coder-1.5B-Instruct with LoRA (~37M params) and TRL GRPOTrainer on one rented RTX 6000 (48 GB). About 10k OCaml problems ported from AceCode-87K using Claude plus programmatic checks. Graduated reward (type-check → compile → tests) plus penalties for degenerate output.
  - Results: compilable output rose from about 2 in 10 to about 7 in 10, with more correct solutions on easy and medium problems. Training converged in about 1.5 epochs, and the best checkpoint came before the final step.
  - Pitfalls: reward hacking (marker spam, markdown spam from a reward bug), chatty apologies that scored the same as broken code, and the graduated reward letting the model settle into "consistent mediocrity". The most useful diagnostic was reward variance within each group, not the loss.
  - Hyperparameters, time and cost were not disclosed.
  - Source: [nilenso blog](https://blog.nilenso.com/blog/2026/05/18/training-a-small-model-to-write-better-ocaml-with-rlvr-and-grpo/)
- **Compilation-error repair with RL** (arXiv 2509.15690): a reward that checks whether the fix compiles and keeps its meaning made Qwen2.5-1.5B-Instruct comparable to Qwen2.5-14B-Instruct on that task (from the search summary; the paper itself was not read in full) — [arXiv 2509.15690](https://arxiv.org/pdf/2509.15690v1)
- **Negative result** (Stanford CS224R student report, not peer-reviewed): GRPO on Qwen2.5-Coder-1.5B with an nvcc/g++ compiler-oracle reward for C++23 did not beat zero-shot pass rate (2/8). The report names compiler latency as the main per-step cost — [CS224R report](https://cs224r.stanford.edu/projects/pdfs/Monami%20Dutta%20Gupta%20submission_416208168/CS224R_Project_Final_Report.pdf)
- **Golang** (Google developer forum): GRPO with NeMo RL on Qwen2.5-Coder-1.5B-Instruct, with partial reward for syntactically valid Go and full reward for correct code — [Google Developers forum](https://discuss.google.dev/t/training-a-golang-expert-slm-small-language-model-with-nemorl-grpo-ray-on-gke/343790)
- **Unsloth GRPO memory** (Feb 2025 announcement): Qwen2.5-1.5B GRPO in about 5 GB VRAM and the 3B notebook in about 7 GB. The default 8 generations per prompt is the main memory driver; 4–6 reduces it — [Unsloth GRPO blog](https://unsloth.ai/blog/grpo); Reddit thread (secondary)

### Inferences
- **Reward design for Jac.** Make the main reward binary or near-binary: tests pass = 1. Add a small shaped bonus for passing `jac check`/compile only early in training, and remove it once the pass rate rises. Penalise non-code or chatty output and enforce a strict output format (one fenced block). Run the compiler in a sandbox with timeouts. Cache compile results, since compiler latency is the bottleneck.
- **Problem selection.** Filter training problems so the post-SFT model solves each one at least occasionally, roughly 10–70% of samples. Groups where all samples pass or all fail give zero advantage and therefore no learning signal.
- **Rough compute (back-of-envelope, not sourced).** 1k–2k prompts × 8 generations × ≤512 tokens on a 1.5B LoRA model is a few hours on a 24 GB card with vLLM generation. The same run is roughly 3–5x slower on a free T4, and must be checkpointed across 12-hour sessions.

### Gaps
- None of the 1.5B examples published exact GRPO wall-clock time or cost. The nilenso post omits them, and Agnostics gives only coarse multi-H100 sweep durations.
- I found no published GRPO result for Jac or any Python-superset language.

## Hardware and cost: free Colab T4, Kaggle (2x T4/P100), 12–24 GB consumer GPUs, rented cloud GPUs; time for 10k–50k examples on 1.5B

### Takeaway
A 1.5B model with QLoRA SFT fits easily on a free Colab T4 (16 GB) or a Kaggle T4. 16-bit LoRA on 1.5–3B fits on 12–24 GB consumer cards. A rented RTX 4090 costs roughly $0.34–0.89/hr and an A100 80GB $0.80–1.79/hr (Oct–Nov 2026). The whole SFT pipeline for 10k–50k examples should cost under about $5–10 on rented hardware or nothing on Colab/Kaggle. GRPO runs at roughly 5–20x the cost of SFT.

### Cited Findings
- **Free notebooks:**
  - Colab: Google's FAQ says free resources "are not guaranteed and not unlimited" and limits fluctuate. Sessions are commonly cited at up to 12 h. Weekly hours are not published (third-party estimates 15–30 h) — [Colab FAQ](https://research.google.com/colaboratory/intl/en-GB/faq.html); [hivenet guide](https://compute.hivenet.com/post/google-colaboratory-gpu-complete-guide-to-free-cloud-gpu-access-and-limitations) (secondary)
  - Kaggle: a weekly GPU quota of about 30 h (users report it floats, roughly 30–41 h, resetting Saturday 00:00 UTC). Accelerator is one P100 or 2x T4. Sessions are reported as 12 h (some sources say 9 h; sources conflict) — [gpuperhour.com, 2026](https://gpuperhour.com/blog/free-cloud-gpus-and-credits) (secondary)
  - Unsloth publishes free Colab T4 notebooks for Qwen2.5 at all sizes — [unsloth/Qwen2.5-Coder-1.5B-Instruct-bnb-4bit model card](https://huggingface.co/unsloth/Qwen2.5-Coder-1.5B-Instruct-bnb-4bit/blame/main/README.md)
- **Rental prices, snapshot 21 Oct 2026** (Vast prices are low/median/high marketplace offers; RunPod is Community/Secure on-demand from its pricing page dated 8 Oct 2026; Lambda per GPU-hour excluding tax):

  | GPU | Vast.ai | RunPod | Lambda |
  |---|---|---|---|
  | RTX 4090 | $0.15 / $0.55 / $2.67 | $0.34 / $0.89 | not offered |
  | A100 SXM4 80GB | $0.44 / $0.80 / $1.41 | $1.39 / $1.79 | $2.79 (8x only) |
  | A100 PCIe | $0.37 / $0.89 / $1.00 | $1.19 / $1.79 | $1.99 (40GB) |
  | H100 SXM | $2.14 / $2.20 / $2.40 | $2.69 / $3.99 | $4.29 (1x), $3.99 (8x) |
  | H100 PCIe | $2.34 | $1.99 / $2.89 | $3.29 (1x) |

  On 3 Nov 2026 the Vast medians were RTX 4090 $0.43, A100 SXM4 $0.80 and H100 SXM $2.40; RunPod and Lambda were unchanged. Source: [joulemath, 21 Oct 2026 (updated 3 Nov)](https://joulemath.com/blog/gpu-rental-prices-h100-h200-a100-rtx-4090-october-2026/)
- **Caveats on providers:** Vast.ai is cheapest but interruptible and depends on the host. RunPod Community has no SLA, while Secure Cloud does. Lambda is the priciest and fully managed — [Tech Insider 2026 comparison](https://tech-insider.org/runpod-vs-lambda-vs-vast-ai-2026/) (secondary)
- **Training-time data points:**
  - Qwen2.5-Coder-1.5B, QLoRA, CodeAlpaca-20k: 1 epoch in about 50 min on an RTX 5060 8 GB (community model card) — [bunyaminergen/Qwen2.5-Coder-1.5B-Instruct-SFT](https://huggingface.co/bunyaminergen/Qwen2.5-Coder-1.5B-Instruct-SFT)
  - nilenso's GRPO run used one 48 GB RTX 6000. Agnostics used 4–8x H100 for about 12–20 h per 4B sweep run (see previous section).

### Inferences (back-of-envelope; label as estimates in the report)
- **SFT tokens and FLOPs.** 20k examples × ~500 tokens ≈ 10M tokens per epoch. LoRA training costs about 4 × 1.5e9 × 1e7 ≈ 6e16 FLOPs per epoch. At realistic utilisation (T4 about 15–25 TFLOPS effective in fp16; RTX 4090 about 60–80 TFLOPS effective), that is about 0.7–1.2 h per epoch on a T4 and about 15–25 min on a 4090. This is consistent with the ~50 min/epoch community data point on a 5060.
- **Scaling to 10k–50k examples on 1.5B, 2–3 epochs:**

  | Hardware | Estimated time | Estimated cost |
  |---|---|---|
  | Free Colab/Kaggle T4 | about 1–6 h, so it may span sessions; checkpoint to Drive/HF Hub | free |
  | RTX 4090 | about 0.3–1.5 h | about $0.15–1.50 |
  | A100 | about 0.2–1 h | about $0.20–2 |

  A 3B model takes about 2x longer and a 0.5B model about 3x shorter.
- **GRPO.** About 1k steps on 1.5B with 8 generations is likely 4–15 h on a 4090 or A100, about $2–25 rented. On a free T4 it is feasible with Unsloth's low-VRAM GRPO, but slow and session-limited.
- **Kaggle 2x T4.** Unsloth's free version targets a single GPU, so the second T4 mostly helps if you run vLLM generation or evaluation on it separately.
- **P100.** Kaggle's P100 option is CUDA capability 6.0, below Unsloth's stated 7.0 minimum. Choose 2x T4 on Kaggle.

### Gaps
- I found no official Google or Kaggle page giving exact current weekly GPU quotas.
- I found no measured wall-clock benchmark for 10k–50k examples on a 1.5B model on a T4. The figures above are extrapolations.
- I did not find current RTX 5090, L4 or L40S rental prices from a dated primary source.

## Pitfalls: catastrophic forgetting, chat template mismatches, overfitting on small data, and mitigations

### Takeaway
The main risks are:
1. Losing general coding and instruction or tool-calling ability (forgetting).
2. Template and EOS mismatches between training and the GGUF/Ollama runtime.
3. Overfitting a small Jac corpus.
4. In RL, reward hacking and collapse.

Mitigations: LoRA rather than full fine-tuning, a low LR and few epochs, replaying 10–30% general code and chat data, responses-only loss, the model's own chat template carried into GGUF, regression evaluation on general benchmarks, and keeping intermediate checkpoints.

### Cited Findings
- **LoRA forgets less than full fine-tuning** and preserves output diversity better, at the cost of learning less of the target domain — [arXiv 2405.09673](https://arxiv.org/html/2405.09673v2)
- **Replay ratios:**
  - Reported effective replay amounts range from as little as 1% pretraining-data injection in one scaling-law study ([arXiv 2506.09428, via search summary only](https://www.arxiv.org/pdf/2506.09428)) up to practitioner rules of thumb of 5–20% or 20–30% general data. None of these is validated specifically for code.
  - A Verilog code-adaptation study found KL-regularised replay almost eliminates forgetting, while plain next-token replay can still forget, depending on the replay distribution.
  - Optimal ratios require an empirical sweep.
  - Source: search summary of [CapTrack arXiv 2603.06610](https://arxiv.org/pdf/2603.06610) and related papers. These citations come from search snippets, not full reads, so treat them as indicative.
- **Chat templates (Unsloth):**
  - Pick the correct `chat_template` for the model family and call `standardize_sharegpt` for ShareGPT data.
  - `map_eos_token=True` maps `<|im_end|>` to EOS.
  - A custom template must contain its EOS token.
  - New tokens must be added before `get_peft_model`.
  - Format with `apply_chat_template(add_generation_prompt=False)` during training.
  - Source: [Unsloth chat templates docs](https://unsloth.ai/docs/basics/chat-templates)
- **GGUF/Ollama:** wrong chat template, EOS or BOS handling at inference is the usual cause of bad output after export — [Unsloth GGUF docs](https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf)
- **Overfitting:**
  - Signal: training loss below 0.2.
  - Remedies: lower LR, fewer epochs, more weight decay or dropout, larger batch, early stopping, or scaling alpha down.
  - 1–3 epochs is the recommended range.
  - Source: [Unsloth LoRA hyperparameters guide](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide/lora-hyperparameters-guide)
- **RL pitfalls:**
  - Reward hacking (format/marker spam, exploiting partial credit, hard-coding public tests, empty programs).
  - Conversational refusals that are not penalised by the reward.
  - Local optima under graduated rewards.
  - Collapse late in training (the best checkpoint was before the end).
  - Sources: [nilenso blog](https://blog.nilenso.com/blog/2026/05/18/training-a-small-model-to-write-better-ocaml-with-rlvr-and-grpo/); [Agnostics arXiv 2508.04865](https://arxiv.org/html/2508.04865v2)
- **Distillation is not enough for a low-resource language.** SFT on frontier-model solutions in a low-resource language helped much less than RL with execution feedback (Fortran: 2–3% vs 15%). Quality-filtering by execution matters — [Agnostics](https://arxiv.org/html/2508.04865v2); [MultiPL-T](https://arxiv.org/html/2308.09895v6)

### Inferences
- **Starting point.** Start from an *instruct* code model (e.g. Qwen2.5-Coder-1.5B/3B-Instruct, or a newer small Qwen3-family coder if available) and keep its native chat template. This preserves its chat and tool-calling format, and the template ships inside the GGUF via Unsloth export. Do not switch templates.
- **SFT data mix.** About 70–85% Jac tasks and about 15–30% replay of general Python/coding and chat data. Include tool-calling examples if the assistant must call tools. Also include Python→Jac and Jac→Python translation pairs to exploit transfer from Python, since Jac is a Python superset.
- **Evaluation gates after each stage:**
  - Jac: compile rate and test pass@1 on a held-out set.
  - General coding regression: HumanEval/MBPP Python.
  - Format and tool-call sanity checks.
  - The exported GGUF itself under llama.cpp/Ollama, not only the HF checkpoint.
- **Tokenizer.** Do not add new tokens for Jac keywords. They train poorly at small data scale, and existing BPE handles Python-like syntax fine.

### Gaps
- I found no published study on forgetting of tool-calling ability specifically after language-specific code fine-tuning of small models.
- The replay-ratio figures come from search summaries of general-domain papers, not code-specific controlled studies. Verify before relying on exact percentages.
