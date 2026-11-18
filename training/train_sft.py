"""LoRA fine-tuning with Unsloth, then GGUF export.

Default base: Qwen3.5-2B (Apache 2.0). Unsloth advises 16-bit LoRA rather than 4-bit QLoRA for Qwen3.5; a 2B model
needs about 5 GB of GPU memory, so a free Colab T4 works. Loss is computed on the assistant's turns only.

  python train_sft.py --data data/sft --out out/jac-2b
  python train_sft.py --data data/sft --out out/jac-2b --cpt     # optional: first adapt on raw Jac text

Needs: pip install --upgrade unsloth unsloth_zoo   (Transformers v5 is required for Qwen3.5)
"""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="unsloth/Qwen3.5-2B")
    ap.add_argument("--data", type=Path, default=Path("data/sft"))
    ap.add_argument("--out", type=Path, default=Path("out/jac-2b"))
    ap.add_argument("--max-seq", type=int, default=8192)
    ap.add_argument("--rank", type=int, default=32)
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--accum", type=int, default=8)
    ap.add_argument("--cpt", action="store_true", help="first train one epoch on data/sft/cpt.jsonl at a low LR")
    ap.add_argument("--quants", default="q5_k_m,q4_k_m,q8_0", help="GGUF quantizations to export ('' to skip)")
    ap.add_argument("--push", default="", help="also push GGUFs to this Hugging Face repo, e.g. you/jaccode-jac-2b-GGUF")
    args = ap.parse_args()

    # Unsloth must be imported before transformers/trl to patch them.
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import train_on_responses_only
    from datasets import load_dataset
    from trl import SFTConfig, SFTTrainer

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base,
        max_seq_length=args.max_seq,
        load_in_4bit=False,
        load_in_16bit=True,
        full_finetuning=False,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.rank,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=args.rank,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
        max_seq_length=args.max_seq,
    )

    def common(**kw) -> SFTConfig:
        return SFTConfig(
            dataset_text_field="text",
            max_seq_length=args.max_seq,
            per_device_train_batch_size=args.batch,
            gradient_accumulation_steps=args.accum,
            warmup_ratio=0.03,
            lr_scheduler_type="cosine",
            logging_steps=10,
            optim="adamw_8bit",
            seed=3407,
            dataset_num_proc=1,
            report_to="none",
            **kw,
        )

    if args.cpt:
        cpt = load_dataset("json", data_files=str(args.data / "cpt.jsonl"), split="train")
        SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=cpt,
            args=common(num_train_epochs=1, learning_rate=args.lr / 4, output_dir=str(args.out / "cpt")),
        ).train()

    def render(ex: dict) -> dict:
        text = tokenizer.apply_chat_template(ex["messages"], tools=ex.get("tools") or None, tokenize=False)
        return {"text": text}

    files = {"train": str(args.data / "train.jsonl")}
    if (args.data / "val.jsonl").stat().st_size > 0:
        files["validation"] = str(args.data / "val.jsonl")
    ds = load_dataset("json", data_files=files)
    ds = ds.map(render, remove_columns=[c for c in ds["train"].column_names if c != "text"])
    has_val = "validation" in ds

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=ds["train"],
        eval_dataset=ds["validation"] if has_val else None,
        args=common(
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            output_dir=str(args.out / "checkpoints"),
            save_strategy="steps",
            save_steps=200,
            save_total_limit=3,
            **({"eval_strategy": "steps", "eval_steps": 200} if has_val else {}),
        ),
    )
    # Qwen chat format: only the assistant's turns count toward the loss. Tool results sit in user turns.
    trainer = train_on_responses_only(trainer, instruction_part="<|im_start|>user\n", response_part="<|im_start|>assistant\n")
    stats = trainer.train()
    print(stats)

    model.save_pretrained(str(args.out / "lora"))
    tokenizer.save_pretrained(str(args.out / "lora"))
    for q in [q for q in args.quants.split(",") if q]:
        model.save_pretrained_gguf(str(args.out / "gguf"), tokenizer, quantization_method=q)
        if args.push:
            model.push_to_hub_gguf(args.push, tokenizer, quantization_method=q)
    print(f"done: LoRA in {args.out / 'lora'}, GGUF in {args.out / 'gguf'}")


if __name__ == "__main__":
    main()
