#!/usr/bin/env python3
"""
Dry rehearsal against the real database state of 2026-11-08, plus the four
failure shapes we actually expect to meet. Prints the exact Telegram messages.

The real values were read from the database on 2026-11-08 and are pasted in
here as a fixture: the sandbox cannot reach Supabase over the network, and a
fixture is in any case the only way to rehearse the broken cases without
breaking anything.
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
)

import watchdog as wd  # noqa: E402

NOW = datetime(2026, 11, 8, 15, 42, tzinfo=wd.BANGKOK)
TODAY = NOW.date()

INTEGRITY_CHECKS = [
    "adjustment_consistency",
    "impossible_bars",
    "missing_trading_days",
    "nulls",
    "zero_volume_recent",
]


def integrity(day: date, bad=None):
    rows = [
        {"run_at": f"{day.isoformat()}T01:00:00.247453+00:00",
         "check_name": n, "status": "ok", "bad_rows": 0}
        for n in INTEGRITY_CHECKS
    ]
    if bad:
        for r in rows:
            if r["check_name"] == bad[0]:
                r.update(status="bad", bad_rows=bad[1])
    return rows


def classification(quarter: date, computed: date, total: int, moved: int):
    return [
        {
            "as_of_quarter": quarter.isoformat(),
            "computed_at": f"{computed.isoformat()}T08:48:00.717684+00:00",
            "bucket": "high_beta",
            "prev_bucket": "market_beta" if i < moved else "high_beta",
        }
        for i in range(total)
    ]


def real_state() -> wd.Snapshot:
    """Exactly what the database held on 2026-11-08."""
    return wd.Snapshot(
        as_of=date(2026, 11, 6),
        facts_max=date(2026, 11, 6),
        integrity=integrity(date(2026, 11, 8)) + integrity(date(2026, 11, 7)),
        health_issues=[],
        flagged=[],
        classification=classification(date(2026, 10, 1), date(2026, 11, 3), 93, 2),
        fomc_last=date(2027, 12, 8),
    )


def show(title: str, snapshot: wd.Snapshot, now: datetime = NOW) -> None:
    findings = wd.build_findings(snapshot, now.date())
    alerts = sum(1 for f in findings if f.level == wd.ALERT)
    print("=" * 68)
    print(f"{title}   [alert {alerts} · note {len(findings) - alerts}]")
    print("-" * 68)
    print(wd.format_message(snapshot, findings, now))
    print()


def main() -> int:
    show("1. สถานะจริงของฐานข้อมูล 8 พ.ย. 2026", real_state())

    s = real_state()
    s.facts_max = date(2026, 11, 5)
    show("2. fact sheet ไม่เกิด (daily-facts-builder พลาดไปทั้งวัน)", s)

    s = real_state()
    s.as_of = date(2026, 11, 1)
    s.facts_max = date(2026, 11, 1)
    s.health_issues = [
        {"ticker": t, "issue": "stale"} for t in ("SPY", "QQQ", "GLD", "XLE")
    ]
    show("3. ข้อมูลหยุดเข้า 7 วัน (daily-fetch ตายเงียบ)", s)

    s = real_state()
    s.integrity = integrity(date(2026, 11, 8), bad=("missing_trading_days", 12))
    s.flagged = [{"ticker": "BNO", "status": "flagged"}]
    show("4. ด่านความถูกต้องไม่ผ่าน + มีราคาถูก flag", s)

    s = real_state()
    s.fomc_last = date(2027, 1, 27)
    s.classification = classification(date(2026, 7, 1), date(2026, 7, 2), 93, 0)
    show("5. ปฏิทิน FOMC ใกล้หมด + ไตรมาสใหม่ไม่ถูกคำนวณ", s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
