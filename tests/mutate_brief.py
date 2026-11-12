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

    ("M12", "scripts/brief.py", "thinking level the model rejects",
     'os.environ.get("GEMINI_THINKING_LEVEL") or "low"',
     'os.environ.get("GEMINI_THINKING_LEVEL") or "minimal"',
     '3.8 Flash answers 400 to "minimal" -- the brief would fail every day'),

    ("M13", "scripts/brief.py", "token ceiling squeezed back down",
     "MAX_OUTPUT_TOKENS = 16384", "MAX_OUTPUT_TOKENS = 4096",
     "thinking would eat the budget and the brief would arrive truncated"),

    ("M14", "scripts/brief.py", "truncation no longer detected",
     'if reason == "MAX_TOKENS":', 'if False and reason == "MAX_TOKENS":',
     "half a brief would be handed to the gates as if it were whole"),

    ("M15", "scripts/brief.py", "thought text glued onto the answer",
     'if isinstance(p, dict) and not p.get("thought"))',
     "if isinstance(p, dict))",
     "the model's reasoning would be prepended to the JSON and break the parse"),

    ("M16", "scripts/brief.py", "empty answer passed along silently",
     "if not text.strip():", "if False and not text.strip():",
     "an empty brief would reach the gates and be reported as a gate failure"),

    ("M17", "scripts/brief.py", "a busy model no longer retried",
     "RETRY_STATUSES = (429, 500, 502, 503, 504)", "RETRY_STATUSES = ()",
     "one 503 would cost the day's brief and redden the morning fetch"),

    ("M18", "scripts/brief.py", "503 dropped from the retry list",
     "RETRY_STATUSES = (429, 500, 502, 503, 504)",
     "RETRY_STATUSES = (429, 500, 502, 504)",
     "503 is the one we actually hit -- the others are the rare ones"),

    ("M19", "scripts/brief.py", "retries fire back-to-back",
     "RETRY_WAITS_S = (15,)", "RETRY_WAITS_S = (0,)",
     "an instant retry hits the same busy second and fails the same way"),

    ("M20", "scripts/brief.py", "timeout stops being retried",
     "        except timeout_exc:", "        except NotImplementedError:",
     "a single slow answer would end the run instead of being tried again"),

    ("M21", "scripts/brief.py", "a real break disguised as a busy model",
     "class ModelUnavailable(RuntimeError):", "ModelUnavailable = RuntimeError",
     "every failure would be reported as 'Google is busy' and nothing would go red"),

    ("M22", "scripts/brief.py", "no quieter model to fall back to",
     'or "gemini-3.6-flash,gemini-2.5-flash").split(",")',
     'or "").split(",")',
     "one busy model would again cost the whole day's brief"),

    ("M23", "scripts/brief.py", "the fallback is never reached",
     "        except ModelUnavailable as exc:\n            last = exc",
     "        except NotImplementedError as exc:\n            last = exc",
     "a busy first model would end the run instead of handing over"),

    ("M24", "scripts/brief.py", "the configured model is reported, not the real one",
     "            return attempt(model), model",
     "            return attempt(model), models[0]",
     "daily_brief.model would name a model that never wrote the row"),

    ("M25", "scripts/brief.py", "read timeout long enough to blow the step cap",
     "READ_TIMEOUT_S = 180", "READ_TIMEOUT_S = 600",
     "the walk would be cut off at 30 minutes instead of reporting a busy model"),
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
