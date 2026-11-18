"""Shared helpers: run the Jac compiler and verify code in a scratch directory."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

JAC = shutil.which("jac")


@dataclass
class JacResult:
    ok: bool
    output: str


def require_jac() -> str:
    if not JAC:
        raise SystemExit(
            "The `jac` CLI is required. Install it with:\n"
            "  curl -fsSL https://raw.githubusercontent.com/jaseci-labs/jaseci/main/scripts/install.sh | bash"
        )
    return JAC


def jac_version() -> str:
    out = subprocess.run([require_jac(), "--version"], capture_output=True, text=True, timeout=30)
    return (out.stdout or out.stderr).strip().splitlines()[0] if (out.stdout or out.stderr) else "unknown"


def run_jac(args: list[str], cwd: Path, timeout: int = 120) -> JacResult:
    try:
        p = subprocess.run([require_jac(), *args], cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return JacResult(p.returncode == 0, (p.stdout + p.stderr)[-4000:])
    except subprocess.TimeoutExpired:
        return JacResult(False, f"timed out after {timeout}s")


def verify(code: str, tests: str | None = None, timeout: int = 120) -> tuple[JacResult, JacResult | None]:
    """Type-checks `code` as solution.jac and, if given, runs `tests` as its solution.test.jac annex."""
    with tempfile.TemporaryDirectory(prefix="jacverify-") as d:
        work = Path(d)
        (work / "solution.jac").write_text(code)
        check = run_jac(["check", "solution.jac"], work, timeout)
        if not check.ok or tests is None:
            return check, None
        (work / "solution.test.jac").write_text(tests)
        return check, run_jac(["test", "solution.jac"], work, timeout)


def read_jsonl(path: Path):
    with open(path) as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def write_jsonl(path: Path, rows) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            n += 1
    return n
