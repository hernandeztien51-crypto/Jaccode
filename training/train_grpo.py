"""Reinforcement learning with the Jac compiler as the reward (GRPO).

Run this after train_sft.py. For each problem the model samples several solutions; a solution earns 1.0 only if
`jac check` and the hidden tests pass, otherwise 0.0. A binary reward avoids the reward hacking that partial
credit invites. Problems the model always or never solves teach nothing, so keep ones it solves sometimes
(see --pilot).

  python train_grpo.py --lora out/jac-2b/lora --problems data/translated.jsonl --out out/jac-2b-rl
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from jaclib import read_jsonl, verify

PROMPT = (
    "Write `solution.jac` in idiomatic Jac for this task. Reply with one ```jac block containing the whole file and "
    "no `with entry` block.\n\nTask: {prompt}\n\nKeep these names and signatures:\n```python\n{sigs}\n```"
)


def signatures(python: str) -> str:
    return "\n".join(l for l in python.splitlines() if l.startswith(("def ", "class "))) or python


def extract(text: str) -> str | None:
    m = re.search(r"```jac\n(.*?)```", text, re.S)
    return m.group(1) if m else None


def compiler_reward(completions, tests, **_) -> list[float]:
    """1.0 when the code type-checks and every hidden test passes, else 0.0."""
    scores = []
    for completion, t in zip(completions, tests):
        text = completion[0]["content"] if isinstance(completion, list) else completion
        code = extract(text)
        if not code:
            scores.append(0.0)
            continue
        check, result = verify(code, t, timeout=60)
        scores.append(1.0 if check.ok and result is not None and result.ok else 0.0)
    return scores


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lora", type=Path, required=True, help="LoRA directory from train_sft.py")
    ap.add_argument("--problems", type=Path, required=True, help="verified translations (translate.py output)")
    ap.add_argument("--out", type=Path, default=Path("out/jac-2b-rl"))
    ap.add_argument("--max-seq", type=int, default=4096)
    ap.add_argument("--generations", type=int, default=8)
    ap.add_argument("--steps", type=int, default=500)
    ap.add_argument("--lr", type=float, default=5e-6)
    ap.add_argument("--pilot", type=int, default=0, help="first sample N problems x 8 and keep those solved 10-70%% of the time")
    ap.add_argument("--quants", default="q5_k_m,q4_k_m,q8_0")
    args = ap.parse_args()

    from unsloth import FastLanguageModel
    from datasets import Dataset
    from trl import GRPOConfig, GRPOTrainer

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(args.lora), max_seq_length=args.max_seq, load_in_4bit=False, load_in_16bit=True
    )

    rows = [
        {"prompt": [{"role": "user", "content": PROMPT.format(prompt=r["prompt"], sigs=signatures(r["python"]))}], "tests": r["tests"]}
        for r in read_jsonl(args.problems)
    ]

    if args.pilot:
        FastLanguageModel.for_inference(model)
        kept = []
        for r in rows[: args.pilot]:
            inputs = tokenizer.apply_chat_template(r["prompt"], add_generation_prompt=True, return_tensors="pt").to(model.device)
            outs = model.generate(inputs, max_new_tokens=1024, do_sample=True, temperature=1.0, num_return_sequences=8)
            texts = tokenizer.batch_decode(outs[:, inputs.shape[1]:], skip_special_tokens=True)
            rate = sum(compiler_reward(texts, [r["tests"]] * len(texts))) / len(texts)
            if 0.1 <= rate <= 0.7:
                kept.append(r)
        print(f"pilot kept {len(kept)}/{min(args.pilot, len(rows))} problems in the 10-70% band")
        rows = kept + rows[args.pilot:]
        FastLanguageModel.for_training(model)

    config = GRPOConfig(
        output_dir=str(args.out / "checkpoints"),
        learning_rate=args.lr,
        num_generations=args.generations,
        per_device_train_batch_size=args.generations,
        gradient_accumulation_steps=1,
        max_prompt_length=1024,
        max_completion_length=1536,
        max_steps=args.steps,
        beta=0.0,
        loss_type="dapo",
        temperature=1.0,
        logging_steps=5,
        save_steps=50,
        save_total_limit=5,
        report_to="none",
    )
    trainer = GRPOTrainer(
        model=model,
        processing_class=tokenizer,
        reward_funcs=[compiler_reward],
        args=config,
        train_dataset=Dataset.from_list(rows),
    )
    trainer.train()

    # RL runs can collapse late: evaluate the saved checkpoints and export the best, not just the last.
    model.save_pretrained(str(args.out / "lora"))
    tokenizer.save_pretrained(str(args.out / "lora"))
    for q in [q for q in args.quants.split(",") if q]:
        model.save_pretrained_gguf(str(args.out / "gguf"), tokenizer, quantization_method=q)
    print(f"done: {args.out}")


if __name__ == "__main__":
    main()
