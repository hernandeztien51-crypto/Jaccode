# Base model choice and shipping for a small Jac coding model (as of 17 Nov 2026)

Scope: 0.5B-3B open-weight base models to fine-tune into a Jac (Jaseci) coding and tool-calling model, with 4B-8B noted for comparison. Also covers converting the result to GGUF and running it in-process from a Node.js CLI. Every number has a date. Items marked **[older]** come from releases before 2026 and have been overtaken by newer models.

## Q1. Which small models are strongest at code generation and tool calling at their size (late 2026)?

### Takeaway
As of Nov 2026 the newest small dense Qwen generation is **Qwen3.5** (0.8B / 2B / 4B / 9B, released 2 Mar 2026, Apache 2.0, with Base checkpoints). It leads its size class on general intelligence and tool-use scores. Qwen has published no code-specific benchmark (HumanEval, MBPP or LiveCodeBench) for the 0.8B and 2B sizes, though. Among small models with published code numbers, **Qwen2.5-Coder-1.5B** **[older, Nov 2024]** is still the best documented code specialist. **Gemma 4 E2B** (Apr 2026, Apache 2.0) has the best published LiveCodeBench score near 2B effective parameters. Qwen3.6 (Apr 2026) came only in 27B and 35B-A3B sizes, and I found no Qwen4.

### Cited Findings

**Qwen3.5 small models (released Feb/Mar 2026)**
- Four dense open-weight models (0.8B, 2B, 4B, 9B) were released on 2 Mar 2026 under Apache 2.0, with Base versions as well. Native context is 262,144 tokens — [GIGAZINE, 3 Mar 2026](https://gigazine.net/gsc_news/en/20260303-qwen-3-5-small); [Artificial Analysis, 5 Mar 2026](https://artificialanalysis.ai/articles/qwen3-5-small-models)
- Qwen3.5-2B architecture: 24 layers, hidden size 2048, laid out as "6 × (3 × (Gated DeltaNet → FFN) → 1 × (Gated Attention → FFN))". That makes it a linear-attention hybrid with a vision encoder. It runs in non-thinking mode by default. The HF card lists the base model as `Qwen/Qwen3.5-2B-Base` — [HF Qwen3.5-2B card](https://huggingface.co/Qwen/Qwen3.5-2B)
- Official instruct scores (HF card, Feb 2026), shown as 0.8B / 2B / Qwen3-4B-2507 for reference:
  - BFCL-V4 (thinking): 25.3 / 43.6 / 39.9
  - TAU2-Bench: 11.6 / 48.8 / 43.2
  - IFEval (non-thinking): 52.1 / 61.2 / 83.4
  - MMLU-Pro: 42.3 / 66.5 / 74.0

  The card reports no LiveCodeBench, HumanEval, MBPP or Codeforces numbers for these sizes — [HF Qwen3.5-2B card](https://huggingface.co/Qwen/Qwen3.5-2B)
- Artificial Analysis Intelligence Index (reasoning variants, 5 Mar 2026):
  - 0.8B = 9 (Qwen3 0.6B = 6.5)
  - 2B = 16 (Qwen3 1.7B ≈ 13)
  - 4B = 27 (Qwen3 4B 2507 = 18)
  - 9B = 32

  The article gives no Coding Index or LiveCodeBench number for these models — [Artificial Analysis](https://artificialanalysis.ai/articles/qwen3-5-small-models)
- The Qwen3.5-2B-Base card says `<|im_start|>`/`<|im_end|>` control tokens were trained "so that LoRA-style PEFT works with the official chat template", so the embeddings do not need fine-tuning. The card gives no base-model benchmark numbers — [HF Qwen3.5-2B-Base](https://huggingface.co/Qwen/Qwen3.5-2B-Base)

**Newer Qwen (Qwen3.6)**
- Qwen3.6 open weights shipped as 35B-A3B MoE (16-17 Apr 2026) and 27B dense (22 Apr 2026), both Apache 2.0. I found no official small (≤8B) Qwen3.6 or any Qwen4. One directory lists a "Qwen3.6-7B" that I could not confirm — [search summary incl. noze.it](https://www.noze.it/en/insights/qwen-3-6/); [labellerr](https://www.labellerr.com/blog/qwen3-6-35b-a3b-open-source-ai-model/)

**Qwen2.5-Coder [older: released 12 Nov 2024; tech report Sep 2024]**
- Licences: 0.5B, 1.5B, 7B, 14B and 32B are **Apache 2.0**. **3B is under the Qwen Research License** — [Qwen blog](https://qwenlm.github.io/blog/qwen2.5-coder-family/)
- Base models (tech report, arXiv 2409.12186). Columns are HumanEval / HE+ / MBPP / MBPP+ / BigCodeBench-Full / MultiPL-E avg:

  | Model | HumanEval | HE+ | MBPP | MBPP+ | BigCodeBench-Full | MultiPL-E avg |
  |---|---|---|---|---|---|---|
  | 0.5B | 28.0 | 23.8 | 52.9 | 47.1 | 16.1 | 24.7 |
  | 1.5B | 43.9 | 36.6 | 69.2 | 58.6 | 34.6 | 41.1 |
  | 3B | 52.4 | 42.7 | 72.2 | 61.4 | 41.1 | 48.0 |

  Source: [arXiv 2409.12186](https://arxiv.org/html/2409.12186)
- Instruct models (same report). Columns are HumanEval / HE+ / MBPP / LiveCodeBench / Aider pass@2:

  | Model | HumanEval | HE+ | MBPP | LiveCodeBench | Aider pass@2 |
  |---|---|---|---|---|---|
  | 0.5B | 61.6 | 57.3 | 52.4 | 2.0 | 14.3 |
  | 1.5B | 70.7 | 66.5 | 69.2 | 6.1 | 31.6 |
  | 3B | 84.1 | 80.5 | 73.6 | 10.8 | 39.1 |

  Source: [arXiv 2409.12186](https://arxiv.org/html/2409.12186)

**Gemma 4 (released 2 Apr 2026)**
- Google released Gemma 4 under **Apache 2.0**, replacing the custom Gemma licence. The edge models are E2B and E4B — [The Register, 2 Apr 2026](https://www.theregister.com/2026/04/02/googles_gemma_4_open_weights/); [VentureBeat](https://venturebeat.com/technology/google-releases-gemma-4-under-apache-2-0-and-that-license-change-may-matter)
- E2B has 2.3B effective parameters and **5.1B including embeddings**. E4B has 4.5B effective and 8B including embeddings. Both have 128K context and native function calling. The base checkpoint is `google/gemma-4-E2B`. Instruct scores:
  - LiveCodeBench v6: E2B **44.0%**, E4B **52.0%**
  - Codeforces Elo: 633 / 940
  - Tau2: 24.5% / 42.2%

  Source: [HF gemma-4-E2B-it card](https://huggingface.co/google/gemma-4-E2B-it). The tech report is arXiv 2607.02770, dated Jul 2026, per that card.

**SmolLM3-3B [older, mid-2025; collection updated Oct 2025]**
- Apache 2.0. Trained at 64k context and extends to 128k with YaRN. Tool calling works through `xml_tools` (JSON inside `<tool_call>`) or `python_tools` — [HF card](https://huggingface.co/HuggingFaceTB/SmolLM3-3B)
- Scores from the same card:

  | Model | Base HE+ | Base MBPP+ | LiveCodeBench v4 (no-think / think) | BFCL (no-think) |
  |---|---|---|---|---|
  | SmolLM3-3B | 30.48 | 52.91 | 15.2 / 30.0 | 92.3 |
  | Qwen3-1.7B | 43.29 | 59.25 | 15.0 / 34.4 | 89.5 |
  | Qwen3-4B | 54.87 | 63.75 | 24.9 / 52.9 | 95.0 |
  | Llama-3.2-3B | 25.00 | 38.88 | — | — |
  | Qwen2.5-3B | 34.14 | 52.11 | — | — |

  Source: [HF SmolLM3-3B](https://huggingface.co/HuggingFaceTB/SmolLM3-3B). This BFCL is a different variant/scale from BFCL-V4 above, so the numbers are not comparable.

**Granite 4.0 Nano [older, 28 Oct 2025]**
- Apache 2.0. Hybrid-SSM variants (H-1B, H-350M) plus plain-transformer variants (1B, 350M). IBM made the transformer versions for runtimes such as llama.cpp where hybrids lacked optimised support — [HF blog](https://huggingface.co/blog/ibm-granite/granite-4-nano); [VentureBeat](https://venturebeat.com/ai/ibms-open-source-granite-4-0-nano-ai-models-are-small-enough-to-run-locally)
- Granite-4.0-1B BFCLv3 is reported as 54.8, the top of its size class — [itsfoss summary](https://itsfoss.com/news/ibm-granite-4-nano/). HumanEval of about 74 for the 1B comes from an unlabelled GGUF-mirror table, so it is unverified — [Mungert GGUF mirror](https://hug-proxy.pages.dev/Mungert/granite-4.0-1b-GGUF)

**LFM2 / LFM2.5 (Liquid AI)**
- LFM2.5-1.2B-Instruct BFCLv3 is 49.12, against Qwen3-1.7B at 46.30 and Granite-4.0-1B at 52.43. IFEval is 86.23. This table comes from a third-party copy of Liquid's card, not the official page — [HF mirror README](https://huggingface.co/ashokgakr75/model-tiny/blob/main/README.md)
- Tool calls are Pythonic, wrapped in `<|tool_call_start|>…<|tool_call_end|>`. vLLM has an lfm2 parser — [vLLM recipe](https://recipes.vllm.ai/LiquidAI/LFM2.5-1.2B-Instruct)

**Phi-4-mini [older, Feb 2025]**
- 3.8B, MIT. Tools are passed as JSON between `<|tool|>…<|/tool|>`. The card warns the model "could sometimes hallucinate function names". It gives no HumanEval or BFCL numbers. MMLU is 67.3, against Llama-3.2-3B at 61.8 and Qwen2.5-3B at 65.0 — [HF card](https://huggingface.co/microsoft/Phi-4-mini-instruct)

### Inferences
- **Ranked shortlist for a Jac coding and tool-calling model, 0.5B-3B (Nov 2026):**
  1. **Qwen3.5-2B-Base.** It is newest, Apache 2.0, has a Base checkpoint, the best BFCL-V4 and TAU2 of any ≤2B model with official numbers, 262K context, and a LoRA-friendly chat template.
     - Risks: no published small-size code scores. The Gated-DeltaNet hybrid needs a recent llama.cpp build (GGUFs exist, see Q4). QLoRA is not recommended (see Q3).
  2. **Qwen2.5-Coder-1.5B (base).** Apache 2.0, a code specialist with solid published numbers (MBPP 69.2 base, HumanEval 70.7 instruct), a plain transformer that every tool supports, and FIM-style pretraining.
     - Risks: Nov 2024 vintage, weak agentic and tool skills, 32K-class context.
     - Its main role is as a low-risk baseline to A/B against #1.
  3. **Gemma 4 E2B.** Apache 2.0, LiveCodeBench v6 of 44% and native function calling.
     - Risk: 5.1B total parameters including per-layer embeddings, so the GGUF and RAM footprint is far larger than "2B" suggests. Expect it to be closer to a 4-5B file.
  4. **Qwen3.5-0.8B-Base / Qwen2.5-Coder-0.5B.** Only worth it if download size has to stay under about 600 MB. Code quality at 0.5B is poor (base HumanEval 28.0).
  5. **Granite-4.0-1B.** Apache 2.0 with strong BFCLv3 (54.8). Its code numbers are not verified.
  6. **SmolLM3-3B.** Apache 2.0 with a fully open recipe, but its base code scores trail Qwen3-1.7B.
  7. **LFM2.5-1.2B.** Good tool and IF scores, but restricted by its licence (Q2).
  8. **Avoid:** Qwen2.5-Coder-3B (research licence) and Llama 3.2 1B/3B (weaker code, naming rules).
- **4B-8B for comparison:**
  - Qwen3.5-4B: Intelligence Index 27, against 16 for the 2B.
  - Gemma 4 E4B: LiveCodeBench v6 52%.
  - Qwen3-4B: LiveCodeBench v4 52.9 in thinking mode, against 34.4 for 1.7B.
  - Phi-4-mini 3.8B: MIT.

  Each step up roughly doubles download size and halves CPU speed (Q5), so it suits an optional "large" tier rather than the default.
- Jac is a superset of Python, so a model strong at Python (MBPP and HumanEval are Python benchmarks) is the right prior. The fine-tune mainly has to teach Jac syntax: walkers, nodes/edges, `by llm`, `with entry`, and so on.

### Gaps
- No official HumanEval, MBPP or LiveCodeBench numbers for Qwen3.5-0.8B or 2B (base or instruct). Gemma 4 E2B HumanEval, MBPP and BFCL are also missing. A side-by-side code comparison would need in-house evaluation.
- Gemma 3 1B/270M **[older, 2025]** and Llama 3.2 1B/3B BFCL figures were not fetched this session.
- I could not verify the official Liquid page for LFM2.5 benchmarks or the official Granite card table for HumanEval.

## Q2. Licences, and whether fine-tuned derivatives can be redistributed

### Takeaway
Apache 2.0 or MIT models (Qwen3.5 all sizes, Qwen2.5-Coder 0.5B/1.5B, Gemma 4, Granite 4.0, SmolLM3, Phi-4-mini) allow redistribution of fine-tuned GGUFs, commercial use included, with standard attribution. Qwen2.5-Coder-3B (non-commercial research licence), LFM (commercial use free only under US$10M revenue) and Llama 3.2 (name must begin "Llama", "Built with Llama" notice) carry conditions that matter for a public npm CLI.

### Cited Findings
- **Qwen3.5 (0.8B, 2B, 4B, 9B, and Base):** Apache 2.0 — [HF Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B); [HF Qwen3.5-2B-Base](https://huggingface.co/Qwen/Qwen3.5-2B-Base)
- **Qwen2.5-Coder:** 0.5B and 1.5B are Apache 2.0; 3B uses the Qwen Research License — [Qwen blog](https://qwenlm.github.io/blog/qwen2.5-coder-family/)
- **Qwen Research License (3B, dated 19 Sep 2024):**
  - "FOR NON-COMMERCIAL PURPOSES ONLY", meaning research or evaluation. Commercial use needs a separate licence from Alibaba Cloud.
  - Redistribution of derivatives is allowed with a copy of the licence, modification notices, a Notice file, and "Built with Qwen" or "Improved using Qwen" shown in docs.

  Source: [Qwen2.5-Coder-3B LICENSE](https://huggingface.co/Qwen/Qwen2.5-Coder-3B/blob/main/LICENSE)
- **Gemma 4:** Apache 2.0, which drops the earlier Gemma Terms of Use and their redistribution and use-policy restrictions — [VentureBeat](https://venturebeat.com/technology/google-releases-gemma-4-under-apache-2-0-and-that-license-change-may-matter); [The Register](https://www.theregister.com/2026/04/02/googles_gemma_4_open_weights/)
- **Granite 4.0 Nano:** Apache 2.0 — [HF blog](https://huggingface.co/blog/ibm-granite/granite-4-nano). **SmolLM3-3B:** Apache 2.0 — [HF](https://huggingface.co/HuggingFaceTB/SmolLM3-3B). **Phi-4-mini:** MIT — [HF](https://huggingface.co/microsoft/Phi-4-mini-instruct)
- **LFM Open License v1.0:**
  - Free for commercial use only while the company's annual revenue is under **US$10M**. Above that, a paid licence is required.
  - Derivatives may be redistributed, with no copyleft, but downstream users stay bound by the licence, including the revenue threshold.

  Source: [Liquid AI LFM license](https://www.liquid.ai/lfm-license)
- **Llama 3.2 Community License:**
  - Any distributed model trained or fine-tuned from Llama must have a name that **begins with "Llama"**.
  - "Built with Llama" must be displayed, and a Notice file included.
  - Companies over 700M MAU (as of 25 Sep 2024) need a separate licence.
  - The Acceptable Use Policy applies.

  Source: [Meta Llama 3.2 license](https://dev.meta.ai/llama/llama3_2/license)

### Inferences
- For a CLI published on npm that downloads a model from Hugging Face, Apache-2.0 bases are the low-friction choice. Ship the upstream LICENSE/NOTICE in the HF repo and model card.
- Any dataset produced by distilling from a larger model has its own terms, separate from the base-model licence. That is outside this scope.

### Gaps
- Gemma 3 (1B/4B) **[older]** uses Gemma Terms of Use. I did not re-fetch those terms this session.
- I did not check Qwen3 (0.6B/1.7B/4B) licence terms directly. My prior knowledge says Apache 2.0, unverified here.

## Q3. Fine-tuning support (Unsloth / TRL / Axolotl) and native tool-call chat templates

### Takeaway
Unsloth explicitly supports Qwen3.5 0.8B-9B, with bf16 LoRA on 3-5 GB of VRAM for ≤2B and one-call GGUF export. It advises against QLoRA for Qwen3.5. All shortlisted models ship tool-calling chat templates, but each uses a different format: Qwen `<tool_call>` JSON, Gemma 4 native, SmolLM3 XML or Python, LFM Pythonic, Phi `<|tool|>`. Training data should be rendered with the exact template that will be used at inference.

### Cited Findings
- **Unsloth Qwen3.5 fine-tuning docs:**
  - Supported sizes are 0.8B, 2B, 4B, 9B, 27B, 35B-A3B and 122B-A10B.
  - bf16 LoRA VRAM: about **3 GB (0.8B), 5 GB (2B), 10 GB (4B)**, 22 GB for 9B. Full fine-tuning takes about 4x more.
  - **QLoRA (4-bit) is not recommended for Qwen3.5** "because of higher-than-normal quantization differences".
  - Needs Transformers v5. Custom Mamba/Triton kernels compile slowly, especially on T4.

  Source: [Unsloth Qwen3.5 fine-tune guide](https://unsloth.ai/docs/models/qwen3.5/fine-tune)
- **Unsloth GGUF export:**
  - `model.save_pretrained_gguf("dir", tokenizer, quantization_method="q4_k_m" | "q8_0" | "f16")` or `push_to_hub_gguf(...)`.
  - The guide warns that bad results in other runtimes usually come from a chat-template or EOS mismatch.

  Source: [Unsloth Qwen3.5 fine-tune guide](https://unsloth.ai/docs/models/qwen3.5/fine-tune)
- **Template details:**
  - Qwen3.5-Base ships a chat template, with control tokens pre-trained for LoRA — [HF Qwen3.5-2B-Base](https://huggingface.co/Qwen/Qwen3.5-2B-Base)
  - Gemma 4 has native function calling — [HF Gemma 4 E2B-it](https://huggingface.co/google/gemma-4-E2B-it)
  - SmolLM3 uses `xml_tools` or `python_tools` — [HF](https://huggingface.co/HuggingFaceTB/SmolLM3-3B)
  - LFM2.5 uses `<|tool_call_start|>` Pythonic calls — [vLLM recipe](https://recipes.vllm.ai/LiquidAI/LFM2.5-1.2B-Instruct)
  - Phi-4-mini uses `<|tool|>` JSON — [HF](https://huggingface.co/microsoft/Phi-4-mini-instruct)

### Inferences
- With a 2B base, a single consumer GPU (≥8 GB) or a free Colab or Kaggle T4 is enough for bf16 LoRA. Expect slow first-step compilation on a T4.
- Two training routes:
  - Start from the **Instruct** checkpoint: it already has tool-calling behaviour and you add Jac knowledge.
  - Start from **Base** with a full SFT mix that includes tool-call traces. This means more data work but no conflict with the original instruct tuning.

  The brief asks for base models. In practice teams often LoRA the instruct model, so evaluate both.

### Gaps
- I did not fetch TRL or Axolotl pages to confirm Qwen3.5 or Gemma 4 support. Hybrid Gated-DeltaNet needs Transformers v5 (per Unsloth), so older TRL/Axolotl pins may break.
- I did not fetch Unsloth's pages for Gemma 4, Granite 4 or Qwen2.5-Coder this session.

## Q4. Shipping: GGUF conversion, file sizes, quantization loss

### Takeaway
The pipeline is: merge the LoRA, run `convert_hf_to_gguf.py` to get BF16, then `llama-quantize` to Q4_K_M, Q5_K_M or Q8_0. Optionally pass `--imatrix` computed on Jac code. Real sizes:
- Qwen3.5-2B: Q4_K_M 1.28 GB, Q5_K_M 1.44 GB, Q8_0 2.01 GB.
- Qwen2.5-Coder-1.5B: 1.12 / 1.29 / 1.89 GB.

Small models are believed to lose proportionally more at 4 bits than large ones. Prefer Q5_K_M or Q6_K for ≤2B and measure on a Jac eval set.

### Cited Findings
- **Official llama.cpp commands:**
  - `python convert_hf_to_gguf.py --outfile model-bf16.gguf --outtype bf16 <hf_dir or --remote repo>`
  - then `./build/bin/llama-quantize model-bf16.gguf model-Q4_K_M.gguf Q4_K_M`
  - Note that the README's own example uses `google/gemma-4-E2B-it`.

  Source: [llama.cpp quantize README](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md)
- **Quant types and imatrix:** available types include Q4_K_S/M, Q5_K_S/M, Q6_K, Q8_0, and IQ quants. `--imatrix file` uses an importance matrix "to minimize accuracy loss" — [llama.cpp quantize README](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md)
- **Bits per weight and generation speed (Llama 3.1 8B, GPU):**

  | Quant | Bits/weight | Size | Generation t/s |
  |---|---|---|---|
  | Q4_K_M | 4.89 | 4.58 GiB | 71.9 |
  | Q5_K_M | 5.70 | 5.33 GiB | 67.2 |
  | Q6_K | 6.56 | 6.14 GiB | 58.7 |
  | Q8_0 | 8.50 | 7.95 GiB | 50.9 |
  | F16 | 16.0 | 14.96 GiB | 29.2 |

  Source: [llama.cpp quantize README](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md)
- **Qwen3.5-2B GGUF (Unsloth):** Q4_K_M 1.28 GB, Q5_K_M 1.44 GB, Q6_K 1.57 GB, Q8_0 2.01 GB, BF16 3.78 GB — [HF unsloth/Qwen3.5-2B-GGUF](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/tree/main). These GGUFs existing also shows that llama.cpp supports the Qwen3.5 hybrid architecture.
- **Qwen2.5-Coder-1.5B-Instruct GGUF (official):** Q4_K_M 1.12 GB, Q5_K_M 1.29 GB, Q6_K 1.46 GB, Q8_0 1.89 GB — [HF Qwen GGUF repo](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/tree/main)
- **Quality loss:**
  - 4-bit quantization keeps KL divergence small across Llama 1B, 3B and 8B, while 3-bit divergence shrinks as models get larger — [arXiv 2607.10855 (2026)](https://arxiv.org/pdf/2607.10855)
  - Practitioner guidance says 1B-3B models lose proportionally more at Q4_K_M and suggests Q8_0 for small models. This is opinion, not measurement — [tinyweights.dev](https://tinyweights.dev/posts/gguf-quantization-levels-q4-q5-q8/)
  - An informal Mistral-7B KL comparison puts Q4_K_M well above Q6_K (about 0.1) and Q8_0 (about 0.06) — [search summary, communick.news](https://communick.news/post/385862)
  - None of these sources gives a reliable 1B-specific number.

### Inferences
- **Size estimates for sizes not fetched** (bits per weight × parameters; Qwen's large tied embeddings add overhead):
  - 0.5B (Qwen2.5-Coder-0.5B / Qwen3.5-0.8B): Q4_K_M about 0.4-0.55 GB, Q8_0 about 0.55-0.9 GB.
  - 3B: Q4_K_M about 1.9-2.0 GB, Q5_K_M about 2.2 GB, Q8_0 about 3.3 GB.
  - Gemma 4 E2B (5.1B total including embeddings): likely about 3 GB at Q4_K_M. This is not verified.
- **Recommended default:** a Q5_K_M (or Q6_K) build of a ~2B model at about 1.4-1.6 GB, with imatrix computed on Jac and Python samples. Also publish Q4_K_M (smaller download) and Q8_0 (best quality) in the same HF repo so users can pick with `hf:org/repo:Q8_0`.
- Before converting, check that the saved tokenizer and chat template (`tokenizer_config.json` / `chat_template.jinja`) match training. llama.cpp embeds the template in GGUF metadata, and node-llama-cpp reads it.

### Gaps
- No measured perplexity or KLD for Q4/Q5/Q8 on Qwen3.5-2B or Qwen2.5-Coder-1.5B. This should be measured with `llama-perplexity --kl-divergence` and a Jac pass@k eval.
- The 0.5B and 3B GGUF file sizes were estimated, not fetched.

## Q5. Running in-process from Node.js (node-llama-cpp, transformers.js, CPU speed and RAM)

### Takeaway
**node-llama-cpp 3.22.3** (MIT, published 5 Nov 2026, Node ≥20, about 455k downloads a week) is the mature in-process option:
- prebuilt binaries for macOS, Linux and Windows, CPU, Metal, CUDA and Vulkan
- `hf:` URI auto-download through `resolveModelFile`
- JSON-schema grammars
- `defineChatSessionFunction` function calling

transformers.js 4.3.2 with ONNX is the alternative. A laptop CPU should give roughly 25-40 tok/s at 1.5B Q4 and 10-20 tok/s at 3B Q4, from secondary sources only.

### Cited Findings
- **npm registry, fetched 17 Nov 2026:**
  - `node-llama-cpp` latest is **3.22.3** (published 2026-11-05), licence MIT, `engines.node >=20.0.0`, main package unpacked about **41.3 MB**.
  - Optional per-platform binary packages: mac-x64, mac-arm64-metal, linux-x64, linux-arm64, linux-armv7l, linux-riscv64, win-x64, win-arm64, plus -cuda, -cuda-ext and -vulkan variants.
  - Unpacked sizes: linux-x64 about 34.3 MB, win-x64 about 34.0 MB, linux-x64-vulkan about 75.6 MB, linux-x64-cuda about 209 MB.
  - Weekly downloads for 10-16 Nov 2026: 455,385.

  Source: [npm registry node-llama-cpp](https://registry.npmjs.org/node-llama-cpp); [npm downloads API](https://api.npmjs.org/downloads/point/last-week/node-llama-cpp)
- **Release history:** 3.22.0 (27 Sep 2026) added "structured decisions with any model". 3.22.2 (17 Oct) adapted to breaking llama.cpp changes. 3.22.3 (5 Nov) fixed JSON-schema `minLength`/`maxLength` Unicode counting — [GitHub releases](https://github.com/withcatai/node-llama-cpp/releases)
- **Binaries and module format:**
  - Prebuilt binaries for macOS, Linux and Windows. Metal is on by default on Apple Silicon. CUDA and Vulkan are used when detected.
  - If no prebuilt matches, it builds llama.cpp from source with cmake. `NODE_LLAMA_CPP_SKIP_DOWNLOAD=true` disables that.
  - The package is ESM only.

  Source: [node-llama-cpp guide](https://node-llama-cpp.withcat.ai/guide/)
- **Model download:**
  - URIs: `hf:<user>/<model>:<quant>` or `hf:<user>/<model>/<file>#<branch>`.
  - `await resolveModelFile("hf:user/model:Q5_K_M", modelsDir)` downloads the file if it is missing. Specifying the quant lets it resolve offline.
  - CLI: `npx --no node-llama-cpp pull --dir ./models <uri>` and `inspect estimate <uri>`.
  - `createModelDownloader` covers custom flows. Gated models use `HF_TOKEN`.

  Source: [node-llama-cpp downloading models](https://node-llama-cpp.withcat.ai/guide/downloading-models)
- **Structured output and function calling:**
  - `llama.createGrammarForJsonSchema()` gives JSON-schema-constrained output.
  - `defineChatSessionFunction({description, params, handler})` is passed as `session.prompt(text, {functions})`.
  - All parameters are treated as required; use `oneOf` with null for optional ones.
  - Custom call syntax is possible through `TemplateChatWrapper`, `JinjaTemplateChatWrapper` or a custom `ChatWrapper`. `functionCallMessageTemplate: "noJinja"` is a fallback when the Jinja tool template performs poorly.

  Source: [function calling guide](https://node-llama-cpp.withcat.ai/guide/function-calling); [guide](https://node-llama-cpp.withcat.ai/guide/)
- **Minimal code (from the docs):**
  ```ts
  import {getLlama, LlamaChatSession, resolveModelFile} from "node-llama-cpp";
  const modelPath = await resolveModelFile("hf:<org>/<jac-model>-GGUF:Q5_K_M", modelsDir);
  const llama = await getLlama();
  const model = await llama.loadModel({modelPath});
  const context = await model.createContext();
  const session = new LlamaChatSession({contextSequence: context.getSequence()});
  const answer = await session.prompt("Write a Jac walker that ...");
  ```
  Source: [guide](https://node-llama-cpp.withcat.ai/guide/); [downloading models](https://node-llama-cpp.withcat.ai/guide/downloading-models)
- **transformers.js alternative:** `@huggingface/transformers` latest is **4.3.2**, unpacked about 10 MB — [npm registry](https://registry.npmjs.org/@huggingface/transformers/latest)
- **CPU speed:**
  - 1.5B Q4_K_M about 40 tok/s and 3B Q4_K_M about 12-15 tok/s, hardware not named — [whatschat.it.com](https://whatschat.it.com/a/26676.html)
  - About 20 tok/s for 3B Q4 on an i7 laptop with dual-channel DDR4 — [InsiderLLM CPU guide](https://insiderllm.com/guides/cpu-only-llms-what-actually-works/)
  - Qwen3 1.7B Q4_K_M at 25-40 tok/s on a 4 GB CPU-only PC — [promptquorum](https://www.promptquorum.com/local-llms/best-cpu-only-llm)
  - All of these are secondary sources. llama-bench is the recommended way to measure on target hardware.
  - Q4_K_M generates faster than Q8_0 because CPU decode is memory-bandwidth bound (71.9 vs 50.9 t/s for 8B in llama.cpp's table) — [llama.cpp quantize README](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md)

### Inferences
- **RAM:** roughly the GGUF file size plus the KV cache plus about 100-300 MB of runtime overhead. For Qwen3.5-2B Q5_K_M with an 8-16K context, that is about 2-2.5 GB of RSS. Qwen3.5 uses full attention in only 1 of 4 layers (6 of 24), so its KV cache should be about 4x smaller than a plain transformer of the same width. That favours long code contexts on laptops.
- **Install footprint:** npm installs optional dependencies whose `os`/`cpu` match. On Linux x64 that may pull the CUDA (209 MB) and Vulkan (76 MB) packages as well as the 34 MB CPU one, unless the CLI pins or omits them. Check with `npm install --omit=optional` combined with an explicit platform package, or with a clean install.
- **Tool-calling reliability:** node-llama-cpp's grammar-constrained function calls (params are schema-enforced) suit a small fine-tuned model. Train on the exact chat template embedded in the GGUF so the auto-selected chat wrapper matches. If it does not, supply a custom `JinjaTemplateChatWrapper`.
- **transformers.js** needs an ONNX export (Optimum) and runs on onnxruntime-node. It is lighter to install, but GGUF k-quants, grammar-constrained sampling and the Qwen3.5 hybrid architecture are less mature there. Treat it as a fallback.
- Expected interactive speed on a typical 2023-2026 laptop CPU (8 cores, DDR4/DDR5):
  - 0.5-0.8B: 50-80+ tok/s
  - 1.5-2B: 25-40 tok/s
  - 3B: 12-20 tok/s

  Prompt processing (prefill) of large Jac files is the real latency cost on CPU and should be benchmarked.

### Gaps
- The node-llama-cpp releases page says it bundles "llama.cpp v0.9.0". That version scheme is unusual, so I could not confirm which upstream llama.cpp build it is, or whether its chat-wrapper auto-detection handles the Qwen3.5 and Gemma 4 tool templates natively. Test with `npx node-llama-cpp chat hf:...`.
- No primary-source CPU benchmarks for Qwen3.5-0.8B/2B or Gemma 4 E2B on laptops. Run `llama-bench` on target machines.
- I did not verify whether transformers.js 4.x supports the Qwen3.5 (Gated DeltaNet) or Gemma 4 architectures in ONNX.
