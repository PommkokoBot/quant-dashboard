#!/usr/bin/env python3
"""Breaks the brief's gates on purpose and fails if the suite does not notice.

The gates are the only thing standing between a model's sentence and a public
page, so "the tests pass" is not evidence about them -- tests that have only
ever been seen green prove nothing. Each mutation below is a weakening someone
could plausibly make while tidying the code or loosening a threshold that felt
too strict, and every one of them must turn the suite red.

Runs from a copy in a temp folder, so nothing here can touch the real scripts.
No symlinks: those need Administrator rights on Windows.

    python tests/mutate_brief.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUITE = "tests/test_brief.py"

# (id, file, what breaks, old, new, why it matters)
MUTATIONS = [
    ("M1", "scripts/brief_gates.py", "adjective threshold loosened",
     "EXTREME_PCTILE = 95.0", "EXTREME_PCTILE = 50.0",
     '"ผิดปกติ" would pass on an ordinary day -- the exact failure ข้อ 11.5 exists to stop'),

    ("M2", "scripts/brief_gates.py", "direction check disabled",
     "if n > 0 and all(f.value < 0 for f in hits):",
     "if False and n > 0 and all(f.value < 0 for f in hits):",
     "a fall could be reported as a rise with the right number attached"),

    ("M3", "scripts/brief_gates.py", "every number treated as a window length",
     "STRUCTURAL_MAX = 31", "STRUCTURAL_MAX = 100000",
     "any invented figure followed by a time word would go unchecked"),

    ("M4", "scripts/brief_gates.py", "ticker gate accepts anything",
     "if token in NON_TICKERS or token in sel.universe:",
     "if True or token in NON_TICKERS or token in sel.universe:",
     "the brief could discuss an instrument we hold no data for"),

    ("M5", "scripts/brief_gates.py", "number matching made sloppy",
     "return abs(round(v, decimals) - n) < 1e-9",
     "return abs(round(v, decimals) - n) < 1.0",
     "9.9% would be accepted as 9.57% -- wrong numbers, quietly published"),

    ("M6", "scripts/brief_facts.py", "a timeframe nobody agreed to",
     "RET_LOOKBACKS = [1, 21]", "RET_LOOKBACKS = [1, 5, 21]",
     "an unused number in the prompt is a number the model may decide to mention"),

    ("M7", "scripts/brief_gates.py", "gate 0 stops checking the date",
     "if got != want_trade_date:", "if False and got != want_trade_date:",
     "yesterday's numbers would be published under today's date"),

    ("M8", "scripts/brief_gates.py", "an advice word dropped from the list",
     '"ควรซื้อ", "ควรขาย"', '"ควรขาย"',
     "the brief would be allowed to tell people what to buy"),

    ("M9", "scripts/brief_facts.py", "the unused groups sent anyway",
     'REQUIRED_GROUPS = ["ret.day", "beta", "rank", "pair", "breadth", "events"]',
     'REQUIRED_GROUPS = ["ret.day", "beta", "rank", "pair", "breadth"]',
     "gate 0 would let a sheet with no event calendar through"),

    ("M10", "scripts/brief_gates.py", "a time word dropped from the list",
     '"วันนี้", "เมื่อวาน"', '"เมื่อวาน"',
     "the brief could say \"today\" to someone reading it two days later"),

    ("M11", "scripts/brief_prompt.py", "prompt edited without a version bump",
     "คุณเขียนสรุปภาวะตลาด ETF ประจำวัน",
     "คุณเขียนสรุปภาวะตลาด ETF รายวัน",
     "two briefs would claim the same prompt_version with different rules behind them"),
]


def run_suite(cwd: Path) -> int:
    return subprocess.run([sys.executable, "-m", "pytest", SUITE, "-q"],
                          cwd=cwd, capture_output=True).returncode


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="qd-brief-mutate-"))
    try:
        for d in ("scripts", "tests"):
            shutil.copytree(ROOT / d, tmp / d)

        if run_suite(tmp) != 0:
            print("baseline FAILS before any mutation -- fix the suite first")
            return 1
        print("baseline (nothing broken): passes")

        missed = 0
        for mid, rel, name, old, new, why in MUTATIONS:
            target = tmp / rel
            original = target.read_text(encoding="utf-8")
            if original.count(old) != 1:
                print(f"{mid} {name:<42} BROKEN  (pattern not found exactly once in {rel})")
                missed += 1
                continue
            target.write_text(original.replace(old, new), encoding="utf-8")
            caught = run_suite(tmp) != 0
            target.write_text(original, encoding="utf-8")
            if not caught:
                missed += 1
            print(f"{mid} {name:<42} {'caught ' if caught else 'MISSED '} ({why})")

        print()
        if missed:
            print(f"{missed} mutation(s) slipped through -- the gates cannot be trusted")
            return 1
        print(f"all {len(MUTATIONS)} mutations caught -- the suite can go red")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
