"""Compiler-verified Python -> Jac translation (the MultiPL-T recipe).

A teacher model translates each Python problem and its tests into Jac. Every result is checked with
`jac check` and `jac test`; on failure the compiler output goes back to the teacher for another try.
Only translations that pass are kept.

Input: JSONL rows {"id", "prompt", "python", "tests"} where tests are Python asserts, or --mbpp to pull MBPP.
Needs ANTHROPIC_API_KEY (or an `ant auth login` profile) and the `jac` CLI.

  python translate.py --mbpp --out data/translated.jsonl --limit 200 --workers 4
"""

from __future__ import annotations

import argparse
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import anthropic

from jaclib import jac_version, read_jsonl, verify, write_jsonl

ROOT = Path(__file__).resolve().parent.parent
FALLBACK_MODELS = {"claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}


def cheatsheet() -> str:
    """The same Jac notes jaccode puts in its prompt, read from src/jac/cheatsheet.ts."""
    src = (ROOT / "src" / "jac" / "cheatsheet.ts").read_text()
    body = src.split("export const JAC_CHEATSHEET = `", 1)[1].split("`.trim();", 1)[0]
    version = re.search(r'JAC_TARGET_VERSION = "([^"]+)"', src).group(1)
    return body.replace("${JAC_TARGET_VERSION}", version).replace("\\`", "`").strip()


SYSTEM = """You translate Python into idiomatic Jac. Reply with exactly two fenced blocks and nothing else:
```jac
<the solution: same function names and behaviour, idiomatic Jac, no `with entry` block>
```
```jac
<tests: one or more `test "name" { assert ...; }` blocks equivalent to the Python asserts; no imports needed>
```

{cheatsheet}"""


def load_rows(args) -> list[dict]:
    if args.mbpp:
        from datasets import load_dataset

        ds = load_dataset("google-research-datasets/mbpp", "full")
        rows = []
        for split in ("train", "validation", "prompt", "test"):
            for r in ds[split]:
                rows.append({"id": f"mbpp-{r['task_id']}", "prompt": r["text"], "python": r["code"], "tests": "\n".join(r["test_list"])})
        return rows
    return list(read_jsonl(args.input))


def extract(text: str) -> tuple[str, str] | None:
    blocks = re.findall(r"```jac\n(.*?)```", text, re.S)
    return (blocks[0].strip() + "\n", blocks[1].strip() + "\n") if len(blocks) >= 2 else None


def ask(client: anthropic.Anthropic, model: str, system: str, messages: list[dict]) -> str:
    extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"} if model in FALLBACK_MODELS else {}
    resp = client.beta.messages.create(
        model=model,
        max_tokens=16000,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        output_config={"effort": "medium"},
        messages=messages,
        **extra,
    )
    if resp.stop_reason == "refusal":
        return ""
    return "".join(b.text for b in resp.content if b.type == "text")


def translate(client, model: str, system: str, row: dict, retries: int) -> dict | None:
    user = f"Task: {row['prompt']}\n\nPython:\n```python\n{row['python']}\n```\n\nPython tests:\n```python\n{row['tests']}\n```"
    messages: list[dict] = [{"role": "user", "content": user}]
    for attempt in range(retries + 1):
        text = ask(client, model, system, messages)
        got = extract(text)
        if not got:
            messages += [{"role": "assistant", "content": text or "(no reply)"}, {"role": "user", "content": "Reply with the two ```jac blocks only."}]
            continue
        code, tests = got
        check, test = verify(code, tests)
        if check.ok and test is not None and test.ok:
            return {"id": row["id"], "prompt": row["prompt"], "python": row["python"], "jac": code, "tests": tests, "attempts": attempt + 1}
        failure = check.output if not check.ok else (test.output if test else "")
        stage = "jac check" if not check.ok else "jac test"
        messages += [
            {"role": "assistant", "content": text},
            {"role": "user", "content": f"`{stage}` failed:\n```\n{failure[-2500:]}\n```\nFix it and reply with both blocks again."},
        ]
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", type=Path)
    src.add_argument("--mbpp", action="store_true")
    ap.add_argument("--out", type=Path, default=Path("data/translated.jsonl"))
    ap.add_argument("--model", default="claude-opus-5-5")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--retries", type=int, default=2)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    version = jac_version()
    rows = load_rows(args)
    if args.limit:
        rows = rows[: args.limit]
    done = {r["id"] for r in read_jsonl(args.out)} if args.out.exists() else set()
    todo = [r for r in rows if r["id"] not in done]
    print(f"{len(todo)} to translate with {args.model} (jac {version}); {len(done)} already done")

    client = anthropic.Anthropic()
    system = SYSTEM.replace("{cheatsheet}", cheatsheet())
    kept = 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "a") as out, ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(translate, client, args.model, system, r, args.retries): r["id"] for r in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                res = fut.result()
            except anthropic.APIError as e:
                print(f"  {futures[fut]}: API error {e}")
                continue
            if res:
                res["jac_version"] = version
                out.write(__import__("json").dumps(res, ensure_ascii=False) + "\n")
                out.flush()
                kept += 1
            if i % 10 == 0:
                print(f"  {i}/{len(todo)} done, {kept} verified")
    print(f"kept {kept}/{len(todo)} verified translations in {args.out}")


if __name__ == "__main__":
    main()
