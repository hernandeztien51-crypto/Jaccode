"""Builds the fine-tuning set from verified data, in the chat-messages + tools format.

Sources (all optional except at least one):
  --translated  verified Python->Jac translations (translate.py)  -> agent-style write/check examples + plain Q&A
  --runs        recorded jaccode trajectories (`--record`)        -> kept only when meta.passed is true
  --corpus      Jac corpus (build_corpus.py)                       -> written separately as text for continued pretraining
  --general     a Hugging Face chat dataset mixed in to limit forgetting (default 20% of the final set)

Everything overlapping the eval suite is dropped.

  python prepare_sft.py --translated data/translated.jsonl --runs data/runs.jsonl --corpus data/corpus.jsonl --out data/sft
"""

from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path

from build_corpus import EVALS, eval_fingerprints, leaks
from jaclib import read_jsonl, write_jsonl

FALLBACK_SYSTEM = (
    "You are jaccode, a coding agent working in the user's terminal. You read, write and run code through your "
    "tools. You are an expert in Jac and Python. Verify Jac with `jac check` before saying it works."
)


def tool(name: str, args: dict, call_id: str) -> dict:
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": args}}


def from_translation(row: dict, system: str, tools: list) -> list[dict]:
    """Two examples per translation: an agent run (write, check, report) and a plain answer."""
    lines = row["jac"].count("\n") + 1
    agent = {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Create `solution.jac` in Jac that does the following:\n\n{row['prompt']}"},
            {"role": "assistant", "content": "", "tool_calls": [tool("write_file", {"path": "solution.jac", "content": row["jac"]}, "c1")]},
            {"role": "tool", "tool_call_id": "c1", "name": "write_file", "content": f"Created solution.jac ({lines} lines)."},
            {"role": "assistant", "content": "", "tool_calls": [tool("jac", {"action": "check", "target": "solution.jac"}, "c2")]},
            {"role": "tool", "tool_call_id": "c2", "name": "jac", "content": "[exit code 0]"},
            {"role": "assistant", "content": "Created `solution.jac`; `jac check` passes."},
        ],
        "tools": tools,
        "meta": {"source": "translation", "id": row["id"]},
    }
    plain = {
        "messages": [
            {"role": "user", "content": f"Translate this Python to idiomatic Jac:\n```python\n{row['python']}\n```"},
            {"role": "assistant", "content": f"```jac\n{row['jac'].rstrip()}\n```"},
        ],
        "meta": {"source": "translation-plain", "id": row["id"]},
    }
    return [agent, plain]


def from_run(run: dict) -> dict:
    """Recorded runs store tool arguments as JSON strings; chat templates such as Qwen's expect objects.
    The run's temporary project path is replaced with a neutral one."""
    msgs = []
    root = re.search(r"on the project at (\S+?)\. ", run["messages"][0]["content"])
    for m in run["messages"]:
        m = dict(m)
        if root and isinstance(m.get("content"), str):
            m["content"] = m["content"].replace(root.group(1), "/workspace/project")
        if m.get("tool_calls"):
            m["tool_calls"] = [
                {**c, "function": {**c["function"], "arguments": json.loads(c["function"]["arguments"] or "{}")}}
                for c in m["tool_calls"]
            ]
        msgs.append(m)
    meta = run.get("meta", {})
    return {"messages": msgs, "tools": run["tools"], "meta": {**meta, "origin": meta.get("source"), "source": "trajectory"}}


def assistant_text(ex: dict) -> str:
    parts = []
    for m in ex["messages"]:
        if m["role"] == "assistant":
            parts.append(m.get("content") or "")
            for c in m.get("tool_calls") or []:
                parts.extend(str(v) for v in c["function"]["arguments"].values())
    return "\n".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--translated", type=Path)
    ap.add_argument("--runs", type=Path, action="append", default=[])
    ap.add_argument("--corpus", type=Path)
    ap.add_argument("--general", default="", help="HF chat dataset with a `messages` column, e.g. HuggingFaceTB/smoltalk")
    ap.add_argument("--general-config", default=None, help="dataset config name, e.g. `all` for smoltalk")
    ap.add_argument("--general-ratio", type=float, default=0.2)
    ap.add_argument("--val", type=float, default=0.05)
    ap.add_argument("--out", type=Path, default=Path("data/sft"))
    ap.add_argument("--seed", type=int, default=13)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    prints = eval_fingerprints()

    runs = [r for path in args.runs for r in read_jsonl(path)]
    eval_ids = {p.name for p in EVALS.iterdir() if p.is_dir()}
    # Runs on the benchmark itself must never become training data.
    runs = [r for r in runs if r.get("meta", {}).get("task") not in eval_ids]
    passed = [r for r in runs if r.get("meta", {}).get("passed") is True]
    system = passed[0]["messages"][0]["content"] if passed else FALLBACK_SYSTEM
    tools = passed[0]["tools"] if passed else []

    examples: list[dict] = [from_run(r) for r in passed]
    if args.translated:
        for row in read_jsonl(args.translated):
            examples.extend(from_translation(row, system, tools))

    before = len(examples)
    examples = [e for e in examples if not leaks(assistant_text(e), prints)]
    dropped = before - len(examples)

    if args.general and examples:
        from datasets import load_dataset

        want = int(len(examples) * args.general_ratio / (1 - args.general_ratio))
        ds = load_dataset(args.general, args.general_config, split="train", streaming=True).shuffle(seed=args.seed)
        for i, r in enumerate(ds):
            if i >= want:
                break
            examples.append({"messages": r["messages"], "meta": {"source": "general"}})

    rng.shuffle(examples)
    n_val = max(1, int(len(examples) * args.val)) if len(examples) > 20 else 0
    write_jsonl(args.out / "val.jsonl", examples[:n_val])
    write_jsonl(args.out / "train.jsonl", examples[n_val:])
    counts: dict[str, int] = {}
    for e in examples:
        counts[e["meta"]["source"]] = counts.get(e["meta"]["source"], 0) + 1
    print(f"train {len(examples) - n_val}, val {n_val}; by source {counts}; dropped {dropped} overlapping the eval; "
          f"{len(runs) - len(passed)} unverified runs skipped")

    if args.corpus:
        n = write_jsonl(args.out / "cpt.jsonl", ({"text": d["text"]} for d in read_jsonl(args.corpus)))
        print(f"continued-pretraining text: {n} documents -> {args.out / 'cpt.jsonl'}")


if __name__ == "__main__":
    main()
