"""Compiler-verified Jac training data from Python problems (the MultiPL-T recipe), free by default.

A teacher model writes a Jac solution for each problem. Every answer is checked with `jac check` and the
problem's tests (`jac test`); on failure the compiler output goes back to the teacher for another try, and
several independent samples can be drawn. Only answers that pass are kept, so a mediocre teacher still
produces correct data; it just keeps fewer problems.

Teachers:
  ollama:<model>   free, runs locally or in Colab (default: Qwen3.5-9B, Apache 2.0). Needs `ollama serve`.
  claude:<model>   optional, needs ANTHROPIC_API_KEY.

MBPP's Python asserts are converted to Jac tests mechanically (no model involved), so the teacher only writes
the solution and the tests can't be "wrong in the student's favour".

  python translate.py --mbpp --out data/translated.jsonl --limit 200
  python translate.py --mbpp --teacher ollama:jaccode-jac --only-missing data/translated.jsonl   # round 2: the student
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from jaclib import jac_version, read_jsonl, verify

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TEACHER = "ollama:hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M"
FALLBACK_MODELS = {"claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}
MODULES = ("math", "re", "heapq", "collections", "itertools", "functools", "string", "bisect", "operator")


def cheatsheet() -> str:
    """The same Jac notes jaccode puts in its prompt, read from src/jac/cheatsheet.ts."""
    src = (ROOT / "src" / "jac" / "cheatsheet.ts").read_text()
    body = src.split("export const JAC_CHEATSHEET = `", 1)[1].split("`.trim();", 1)[0]
    version = re.search(r'JAC_TARGET_VERSION = "([^"]+)"', src).group(1)
    return body.replace("${JAC_TARGET_VERSION}", version).replace("\\`", "`").strip()


SYSTEM_SOLUTION = """You write idiomatic Jac. Reply with exactly one fenced ```jac block holding the whole solution file:
same function names and behaviour as the Python, typed parameters and returns, no `with entry` block, no tests.

{cheatsheet}"""

SYSTEM_BOTH = """You translate Python into idiomatic Jac. Reply with exactly two fenced blocks and nothing else:
```jac
<the solution: same function names and behaviour, idiomatic Jac, no `with entry` block>
```
```jac
<tests: one or more `test "name" { assert ...; }` blocks equivalent to the Python asserts; no imports needed>
```

{cheatsheet}"""


def asserts_to_jac(asserts: list[str]) -> str | None:
    """Python `assert` lines -> Jac test blocks. Returns None when a line isn't a plain assert expression."""
    blocks = []
    used = set()
    for i, line in enumerate(a.strip() for a in asserts if a.strip()):
        if not line.startswith("assert ") or "lambda" in line or line.endswith(":"):
            return None
        used.update(m for m in MODULES if re.search(rf"\b{m}\.", line))
        blocks.append(f'test "case {i + 1}" {{\n    {line.rstrip(";")};\n}}')
    if not blocks:
        return None
    imports = "".join(f"import {m};\n" for m in sorted(used))
    return (imports + "\n" if imports else "") + "\n\n".join(blocks) + "\n"


def load_rows(args) -> list[dict]:
    if args.mbpp:
        from datasets import load_dataset

        ds = load_dataset("google-research-datasets/mbpp", "full")
        rows = []
        for split in ("train", "validation", "prompt", "test"):
            for r in ds[split]:
                if r.get("test_setup_code"):
                    continue
                rows.append({
                    "id": f"mbpp-{r['task_id']}",
                    "prompt": r["text"],
                    "python": r["code"],
                    "tests": "\n".join(r["test_list"]),
                    "tests_jac": asserts_to_jac(r["test_list"]),
                })
        return rows
    return list(read_jsonl(args.input))


def blocks(text: str) -> list[str]:
    return [b.strip() + "\n" for b in re.findall(r"```jac\n(.*?)```", text, re.S)]


class Teacher:
    """A chat model behind one `chat(system, messages)` call."""

    def __init__(self, spec: str, host: str):
        self.kind, _, self.model = spec.partition(":")
        if self.kind not in ("ollama", "claude") or not self.model:
            raise SystemExit(f"--teacher must be ollama:<model> or claude:<model>, got {spec!r}")
        self.host = host.rstrip("/")
        if self.kind == "claude":
            import anthropic

            self.client = anthropic.Anthropic()

    def chat(self, system: str, messages: list[dict], temperature: float) -> str:
        if self.kind == "ollama":
            body = {
                "model": self.model,
                "messages": [{"role": "system", "content": system}, *messages],
                "stream": False,
                "think": False,
                "options": {"temperature": temperature, "num_ctx": 16384},
            }
            req = urllib.request.Request(f"{self.host}/api/chat", json.dumps(body).encode(), {"content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=600) as resp:
                return json.load(resp)["message"]["content"]
        extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"} if self.model in FALLBACK_MODELS else {}
        resp = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            output_config={"effort": "medium"},
            messages=messages,
            **extra,
        )
        if resp.stop_reason == "refusal":
            return ""
        return "".join(b.text for b in resp.content if b.type == "text")


def solve(teacher: Teacher, systems: dict, row: dict, samples: int, retries: int) -> dict | None:
    fixed_tests = row.get("tests_jac")
    system = systems["solution"] if fixed_tests else systems["both"]
    user = f"Task: {row['prompt']}\n\nPython:\n```python\n{row['python']}\n```"
    if not fixed_tests:
        user += f"\n\nPython tests:\n```python\n{row['tests']}\n```"
    for sample in range(samples):
        messages: list[dict] = [{"role": "user", "content": user}]
        temperature = 0.2 if sample == 0 else 0.8
        for attempt in range(retries + 1):
            text = teacher.chat(system, messages, temperature)
            got = blocks(text)
            need = 1 if fixed_tests else 2
            if len(got) < need:
                messages += [{"role": "assistant", "content": text or "(no reply)"},
                             {"role": "user", "content": f"Reply with exactly {need} ```jac block(s) only."}]
                continue
            code, tests = got[0], (fixed_tests or got[1])
            check, test = verify(code, tests)
            if check.ok and test is not None and test.ok:
                return {"id": row["id"], "prompt": row["prompt"], "python": row["python"], "jac": code, "tests": tests,
                        "teacher": f"{teacher.kind}:{teacher.model}", "sample": sample + 1, "attempts": attempt + 1}
            failure = check.output if not check.ok else (test.output if test else "")
            stage = "jac check" if not check.ok else "jac test"
            messages += [{"role": "assistant", "content": text},
                         {"role": "user", "content": f"`{stage}` failed:\n```\n{failure[-2500:]}\n```\nFix the solution and reply again."}]
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", type=Path, help="JSONL rows {id, prompt, python, tests[, tests_jac]}")
    src.add_argument("--mbpp", action="store_true")
    ap.add_argument("--out", type=Path, default=Path("data/translated.jsonl"))
    ap.add_argument("--teacher", default=DEFAULT_TEACHER, help="ollama:<model> (free) or claude:<model>")
    ap.add_argument("--ollama-host", default=os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434"))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--samples", type=int, default=2, help="independent tries per problem")
    ap.add_argument("--retries", type=int, default=2, help="compiler-feedback rounds per try")
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()
    if not args.ollama_host.startswith("http"):
        args.ollama_host = "http://" + args.ollama_host

    version = jac_version()
    rows = [r for r in load_rows(args) if not (args.mbpp and r.get("tests_jac") is None)]
    if args.limit:
        rows = rows[: args.limit]
    done = {r["id"] for r in read_jsonl(args.out)} if args.out.exists() else set()
    todo = [r for r in rows if r["id"] not in done]
    print(f"{len(todo)} problems for {args.teacher} ({version}); {len(done)} already solved")

    teacher = Teacher(args.teacher, args.ollama_host)
    sheet = cheatsheet()
    systems = {"solution": SYSTEM_SOLUTION.replace("{cheatsheet}", sheet), "both": SYSTEM_BOTH.replace("{cheatsheet}", sheet)}
    kept = 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "a") as out, ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(solve, teacher, systems, r, args.samples, args.retries): r["id"] for r in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                res = fut.result()
            except Exception as e:  # one bad problem shouldn't stop the run
                print(f"  {futures[fut]}: {type(e).__name__}: {e}")
                continue
            if res:
                res["jac_version"] = version
                out.write(json.dumps(res, ensure_ascii=False) + "\n")
                out.flush()
                kept += 1
            if i % 10 == 0:
                print(f"  {i}/{len(todo)} done, {kept} verified")
    print(f"kept {kept}/{len(todo)} verified solutions in {args.out}")


if __name__ == "__main__":
    main()
