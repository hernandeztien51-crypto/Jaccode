"""Compares `jaccode eval --out` result files side by side.

  python compare.py base.json trained.json [claude.json ...]
"""

from __future__ import annotations

import json
import sys
from collections import Counter


def stats(path: str) -> dict:
    data = json.load(open(path))
    rs = data["results"]
    n = len(rs) or 1
    codes = Counter(c for r in rs for c in r.get("errorCodes", []))
    return {
        "name": data.get("model", path),
        "tasks": len(rs),
        "pass@1": sum(r["passed"] for r in rs) / n,
        "compiles": sum(r["compiles"] for r in rs) / n,
        "foreign": sum(r["foreignSyntax"] > 0 for r in rs) / n,
        "sec/task": sum(r["seconds"] for r in rs) / n,
        "top errors": ", ".join(f"{c}x{k}" for c, k in codes.most_common(3)) or "-",
        "passed": {r["id"] for r in rs if r["passed"]},
    }


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    runs = [stats(p) for p in sys.argv[1:]]
    width = max(len(r["name"]) for r in runs) + 2
    print(f"{'model':<{width}}{'tasks':>6}{'pass@1':>9}{'compiles':>10}{'foreign':>9}{'sec/task':>10}  top errors")
    for r in runs:
        print(f"{r['name']:<{width}}{r['tasks']:>6}{r['pass@1']:>9.1%}{r['compiles']:>10.1%}{r['foreign']:>9.1%}"
              f"{r['sec/task']:>10.1f}  {r['top errors']}")
    base, last = runs[0], runs[-1]
    gained = sorted(last["passed"] - base["passed"])
    lost = sorted(base["passed"] - last["passed"])
    print(f"\n{last['name']} vs {base['name']}: {last['pass@1'] - base['pass@1']:+.1%} pass@1")
    print(f"  newly solved: {', '.join(gained) or 'none'}")
    print(f"  newly failed: {', '.join(lost) or 'none'}")


if __name__ == "__main__":
    main()
