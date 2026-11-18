#!/usr/bin/env python3
"""
Proof that tests/test_watchdog.py can fail.

A test suite that has only ever been seen passing is not evidence of anything.
This script copies the scripts + tests into a scratch directory, breaks one
thing at a time, and asserts that the suite goes red for every single break.
If any mutation survives, that line of the watchdog is effectively untested and
the script exits non-zero.

Run:  python tests/mutate_watchdog.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# (name, what it breaks, old text, new text)
MUTATIONS = [
    # --- 17 พ.ย. · ด่านใหม่สามตัว ---
    (
        "M12 weekly brief staleness",
        "a week could pass with no published brief and nothing would say so",
        "    if published < due:",
        "    if published < due - timedelta(days=99):",
    ),
    (
        "M13 saturday grace removed",
        "the brief gate would fire every Saturday morning before the queue "
        "has even dispatched the run, and a gate that cries wolf stops being read",
        "    if today.weekday() == 5:\n        return []",
        "    if False:\n        return []",
    ),
    (
        "M14 membership snapshot staleness",
        "pg_cron could stop taking snapshots and we would find out on the day "
        "we open the history and see the gap -- the day it cannot be bought back",
        "    if age >= MAX_SNAPSHOT_AGE_DAYS:",
        "    if age >= MAX_SNAPSHOT_AGE_DAYS + 30:",
    ),
    (
        "M15 fetch pulse threshold",
        "the daily job could stop running for days while the five-day rule "
        "still reports everything as normal over a long weekend",
        "    if gap >= MAX_FETCH_GAP_HOURS:",
        "    if gap >= MAX_FETCH_GAP_HOURS * 10:",
    ),
    (
        "M16 pulse gate unplugged from build_findings",
        "the gate would still pass its own tests while never running in production",
        "    findings += check_fetch_pulse(snapshot.fetch_last_at, now)",
        "    findings += []",
    ),
    (
        "M1 no-data threshold",
        "price data could stop arriving for 99 days without a word",
        "MAX_DATA_AGE_DAYS = 5",
        "MAX_DATA_AGE_DAYS = 99",
    ),
    (
        "M2 integrity staleness",
        "the nightly integrity job could stop and never be noticed",
        "MAX_INTEGRITY_AGE_DAYS = 2",
        "MAX_INTEGRITY_AGE_DAYS = 99",
    ),
    (
        "M3 classification grace",
        "a missing quarter would never be reported",
        "CLASSIFICATION_GRACE_DAYS = 8",
        "CLASSIFICATION_GRACE_DAYS = 999",
    ),
    (
        "M4 FOMC early warning",
        "the calendar would only be mentioned once it is nearly empty",
        "FOMC_NOTE_DAYS = 183",
        "FOMC_NOTE_DAYS = 62",
    ),
    (
        "M5 fact sheet comparison",
        "a missing fact sheet would pass unnoticed",
        "    if facts_max < as_of:",
        "    if False and facts_max < as_of:",
    ),
    (
        "M6 integrity verdict inverted",
        "green checks reported as failures and failures as green",
        'bad = [r for r in latest_rows if r.get("status") != "ok"]',
        'bad = [r for r in latest_rows if r.get("status") == "ok"]',
    ),
    (
        "M7 flagged severity",
        "a flagged price would read as a breakage",
        '            NOTE,\n            "flagged",',
        '            ALERT,\n            "flagged",',
    ),
    (
        "M9 completeness check disabled",
        "a sheet built from a partial universe would pass unmentioned",
        '    if coverage.get("is_complete"):\n        return []',
        "    if True:\n        return []",
    ),
    (
        "M10 duplicate-alert suppression inverted",
        "one bad morning would send two alerts about the same cause",
        "    findings += coverage\n    if not coverage:",
        "    findings += coverage\n    if True:",
    ),
    (
        "M11 heartbeat drops the count",
        "a universe shrinking week by week would never be seen",
        '    return f"ราคา {coverage[\'n_priced\']}/{baseline}"',
        '    return "ราคา —"',
    ),
    (
        "M8 integrity reads every run",
        "a failure fixed days ago would keep alerting forever",
        '    latest_rows = [r for r, d in zip(rows, days) if d == latest]\n'
        '    bad = [r for r in latest_rows if r.get("status") != "ok"]',
        "    latest_rows = list(rows)\n"
        '    bad = [r for r in latest_rows if r.get("status") != "ok"]',
    ),
]


def run_suite(root: Path) -> bool:
    """True when the suite passes."""
    # -B for the same reason as tests/mutate_brief.py: a cached .pyc from the
    # previous mutation's run can make this script report "caught" for a
    # mutation the suite never catches.
    result = subprocess.run(
        [sys.executable, "-B", "-m", "pytest", "tests/test_watchdog.py", "-q"],
        cwd=root,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / "repo"
        base.mkdir()
        for folder in ("scripts", "tests"):
            shutil.copytree(REPO / folder, base / folder)

        print("baseline (nothing broken):", end=" ")
        if not run_suite(base):
            print("FAILED -- the suite is red before any mutation")
            return 1
        print("passes")

        target = base / "scripts" / "watchdog.py"
        original = target.read_text(encoding="utf-8")

        survivors = []
        for name, breaks, old, new in MUTATIONS:
            if original.count(old) != 1:
                print(f"{name:32s} SKIPPED -- anchor text found {original.count(old)}x")
                survivors.append(name)
                continue
            target.write_text(original.replace(old, new), encoding="utf-8")
            passed = run_suite(base)
            target.write_text(original, encoding="utf-8")
            status = "SURVIVED" if passed else "caught"
            print(f"{name:32s} {status:9s} ({breaks})")
            if passed:
                survivors.append(name)

        print()
        if survivors:
            print(f"{len(survivors)} mutation(s) survived: {', '.join(survivors)}")
            return 1
        print(f"all {len(MUTATIONS)} mutations caught -- the suite can go red")
        return 0


if __name__ == "__main__":
    sys.exit(main())
