"""Collects user-style Jac code from a Jaseci checkout into a deduplicated corpus.

Keeps example apps, code blocks from the docs, and the guides bundled with the CLI. Skips compiler internals
and test fixtures (many fixtures are deliberately broken). With --verify, each snippet that is a complete
file must pass `jac check`; snippets from docs are kept as reference text either way.

  git clone --depth 1 https://github.com/jaseci-labs/jaseci
  python build_corpus.py --jaseci jaseci --out data/corpus.jsonl --verify
"""

from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path

from jaclib import jac_version, verify, write_jsonl

EVALS = Path(__file__).resolve().parent.parent / "evals" / "jac"
FENCE = re.compile(r"```jac\n(.*?)```", re.S)


def eval_fingerprints() -> set[str]:
    """Normalized lines from the eval references, so the corpus can't leak answers."""
    prints: set[str] = set()
    for ref in EVALS.glob("*/reference.jac"):
        for line in ref.read_text().splitlines():
            norm = " ".join(line.split())
            if len(norm) > 30:
                prints.add(norm)
    return prints


def leaks(text: str, prints: set[str]) -> bool:
    lines = [" ".join(l.split()) for l in text.splitlines()]
    hits = sum(1 for l in lines if l in prints)
    return hits >= 3


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jaseci", type=Path, required=True, help="path to a jaseci-labs/jaseci checkout")
    ap.add_argument("--out", type=Path, default=Path("data/corpus.jsonl"))
    ap.add_argument("--verify", action="store_true", help="keep only example files that pass `jac check`")
    ap.add_argument("--max-chars", type=int, default=24000)
    args = ap.parse_args()

    jac_root = args.jaseci / "jac"
    sources: list[tuple[str, str, bool]] = []  # (source, text, is_whole_file)

    for f in sorted((jac_root / "examples").rglob("*.jac")):
        sources.append((str(f.relative_to(args.jaseci)), f.read_text(errors="ignore"), True))
    for md in sorted((jac_root / "jaclang" / "cli").rglob("*.md")):
        text = md.read_text(errors="ignore")
        rel = str(md.relative_to(args.jaseci))
        if "/skills/" in rel:
            sources.append((rel, text, False))  # guides: prose + code, useful as-is
        for i, block in enumerate(FENCE.findall(text)):
            sources.append((f"{rel}#{i}", block, False))

    prints = eval_fingerprints()
    seen: set[str] = set()
    rows = []
    dropped = {"duplicate": 0, "too_long": 0, "eval_overlap": 0, "fails_check": 0}
    version = jac_version() if args.verify else None
    for src, text, whole in sources:
        text = text.strip()
        if not text:
            continue
        digest = hashlib.sha256(" ".join(text.split()).encode()).hexdigest()
        if digest in seen:
            dropped["duplicate"] += 1
            continue
        seen.add(digest)
        if len(text) > args.max_chars:
            dropped["too_long"] += 1
            continue
        if leaks(text, prints):
            dropped["eval_overlap"] += 1
            continue
        verified = None
        if args.verify and whole:
            check, _ = verify(text)
            verified = check.ok
            if not check.ok:
                dropped["fails_check"] += 1
                continue
        rows.append({"source": src, "text": text, "verified": verified, "jac_version": version})

    n = write_jsonl(args.out, rows)
    print(f"wrote {n} documents to {args.out}; dropped {dropped}")


if __name__ == "__main__":
    main()
