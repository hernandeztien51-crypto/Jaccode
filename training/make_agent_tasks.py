"""Turns verified translations into agent tasks in the same folder format as evals/jac.

Each translation yields up to four tasks: write from a description, port from Python, fix compile errors
(the solution with Python-isms injected), and fix a logic bug (a mutated operator caught by the tests).
Run a strong model over them with `jaccode eval --tasks <out> --record runs.jsonl`; prepare_sft.py keeps only
runs whose hidden tests passed.

  python make_agent_tasks.py --translated data/translated.jsonl --out data/agent_tasks
"""

from __future__ import annotations

import argparse
import random
import re
import shutil
from pathlib import Path

from jaclib import read_jsonl, verify

SYNTAX_BREAKS = [
    (r" and ", " && "),
    (r" or ", " || "),
    (r"\bTrue\b", "true"),
    (r"\bFalse\b", "false"),
    (r"(import from [\w.]+ \{[^}]*\})", r"\1;"),
    (r";\n", "\n"),  # drop one semicolon
    (r"\bdef (\w+)\(", r"function \1("),
]

LOGIC_BREAKS = [(r" < ", " <= "), (r" <= ", " < "), (r" > ", " >= "), (r" \+ 1\b", ""), (r" - 1\b", ""), (r"\[1:\]", "[0:]"), (r" == 0", " != 0")]


def mutate(code: str, rules: list[tuple[str, str]], rng: random.Random, count: int) -> str | None:
    """Applies `count` single-site mutations at random places; None if nothing applies."""
    out = code
    applied = 0
    for pattern, repl in rng.sample(rules, len(rules)):
        matches = list(re.finditer(pattern, out))
        if not matches:
            continue
        m = rng.choice(matches)
        out = out[: m.start()] + re.sub(pattern, repl, m.group(0), count=1) + out[m.end():]
        applied += 1
        if applied == count:
            break
    return out if applied and out != code else None


def write_task(root: Path, tid: str, prompt: str, reference: str, tests: str, setup: dict[str, str]) -> None:
    d = root / tid
    if d.exists():
        shutil.rmtree(d)
    (d / "setup").mkdir(parents=True)
    (d / "task.md").write_text(prompt.strip() + "\n")
    (d / "reference.jac").write_text(reference)
    (d / "solution.test.jac").write_text(tests)
    for name, text in setup.items():
        (d / "setup" / name).write_text(text)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--translated", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("data/agent_tasks"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-verify", action="store_true", help="skip checking that broken variants really fail")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    made = {"write": 0, "port": 0, "fix_syntax": 0, "fix_logic": 0}

    for row in read_jsonl(args.translated):
        rid = re.sub(r"[^\w-]", "_", row["id"])
        code, tests = row["jac"], row["tests"]

        write_task(args.out, f"{rid}-write", f"Create `solution.jac` in Jac that does the following:\n\n{row['prompt']}\n\n"
                   f"Use these names and signatures:\n```python\n{signatures(row['python'])}\n```", code, tests, {})
        made["write"] += 1

        write_task(args.out, f"{rid}-port", "Port `original.py` to idiomatic Jac in a new file `solution.jac`, keeping the same "
                   "function names, parameters and behaviour.", code, tests, {"original.py": row["python"]})
        made["port"] += 1

        broken = mutate(code, SYNTAX_BREAKS, rng, count=rng.randint(1, 3))
        if broken and (args.no_verify or not verify(broken)[0].ok):
            write_task(args.out, f"{rid}-fix_syntax", "`solution.jac` fails `jac check`. Fix every error without changing what it does.",
                       code, tests, {"solution.jac": broken})
            made["fix_syntax"] += 1

        buggy = mutate(code, LOGIC_BREAKS, rng, count=1)
        if buggy:
            ok = True
            if not args.no_verify:
                check, test = verify(buggy, tests)
                ok = check.ok and test is not None and not test.ok  # compiles, but a test catches the bug
            if ok:
                write_task(args.out, f"{rid}-fix_logic", f"`solution.jac` is supposed to do this:\n\n{row['prompt']}\n\n"
                           "Its tests are failing. Find and fix the bug.", code, tests, {"solution.jac": buggy})
                made["fix_logic"] += 1

    print(f"wrote tasks to {args.out}: {made}")


def signatures(python: str) -> str:
    return "\n".join(l for l in python.splitlines() if l.startswith("def ") or l.startswith("class ")) or python


if __name__ == "__main__":
    main()
