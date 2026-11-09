#!/usr/bin/env python3
"""
Tests for the watchdog's judgement logic.

Every check is a pure function, so these tests need no database and no
network: they feed in a shaped snapshot and assert on the findings. Each check
is tested on BOTH sides of its threshold -- a test suite that only ever sees
healthy input cannot tell a working watchdog from one that always returns "ok".

Run:  pytest tests/test_watchdog.py -q
Prove it can fail:  python tests/mutate_watchdog.py
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
)

import notify  # noqa: E402
import watchdog as wd  # noqa: E402

TODAY = date(2026, 11, 9)          # a Monday
AS_OF = date(2026, 11, 6)          # the Friday before
NOW = datetime(2026, 11, 9, 15, 42, tzinfo=wd.BANGKOK)


def integrity_rows(day: date, bad: dict | None = None) -> list[dict]:
    names = [
        "adjustment_consistency",
        "impossible_bars",
        "missing_trading_days",
        "nulls",
        "zero_volume_recent",
    ]
    rows = [
        {"run_at": f"{day.isoformat()}T01:00:00.247453+00:00",
         "check_name": n, "status": "ok", "bad_rows": 0}
        for n in names
    ]
    if bad:
        for row in rows:
            if row["check_name"] == bad["check_name"]:
                row.update(status="bad", bad_rows=bad["bad_rows"])
    return rows


def classification_rows(quarter: date, computed: date, moved: int = 0, total: int = 93):
    rows = []
    for i in range(total):
        bucket = "high_beta"
        prev = "high_beta" if i >= moved else "market_beta"
        rows.append({
            "as_of_quarter": quarter.isoformat(),
            "computed_at": f"{computed.isoformat()}T02:00:00+00:00",
            "bucket": bucket,
            "prev_bucket": prev,
        })
    return rows


def healthy_snapshot() -> wd.Snapshot:
    return wd.Snapshot(
        as_of=AS_OF,
        facts_max=AS_OF,
        integrity=integrity_rows(TODAY),
        health_issues=[],
        flagged=[],
        classification=classification_rows(date(2026, 10, 1), date(2026, 10, 1)),
        fomc_last=date(2027, 12, 8),
    )


# --------------------------------------------------------------------------
# A healthy day produces nothing to report
# --------------------------------------------------------------------------


def test_healthy_snapshot_has_no_findings():
    assert wd.build_findings(healthy_snapshot(), TODAY) == []


def test_healthy_message_is_the_one_line_heartbeat():
    snap = healthy_snapshot()
    message = wd.format_message(snap, wd.build_findings(snap, TODAY), NOW)
    assert message.startswith("✅")
    assert "fact sheet ครบ" in message
    assert "ความถูกต้อง 5/5" in message
    assert "\n" not in message          # genuinely one line when all is well


# --------------------------------------------------------------------------
# 1. price data arriving at all
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "age,expect_alert",
    [(0, False), (3, False), (4, False), (5, True), (9, True)],
)
def test_data_arrival_threshold(age, expect_alert):
    findings = wd.check_data_arrival(TODAY - timedelta(days=age), TODAY)
    assert bool(findings) is expect_alert
    if expect_alert:
        assert findings[0].level == wd.ALERT


def test_data_arrival_with_no_data_at_all():
    findings = wd.check_data_arrival(None, TODAY)
    assert [f.code for f in findings] == ["no_data"]


# --------------------------------------------------------------------------
# 2. fact sheet keeping up with the price data
# --------------------------------------------------------------------------


def test_fact_sheet_in_sync_is_silent():
    assert wd.check_fact_sheet(AS_OF, AS_OF) == []


def test_fact_sheet_one_day_behind_alerts():
    findings = wd.check_fact_sheet(AS_OF - timedelta(days=1), AS_OF)
    assert [f.code for f in findings] == ["facts_behind"]
    assert "ช้า 1 วัน" in findings[0].text


def test_fact_sheet_missing_entirely_alerts():
    assert [f.code for f in wd.check_fact_sheet(None, AS_OF)] == ["no_facts"]


def test_fact_sheet_silent_when_there_is_no_price_data_to_compare():
    # check_data_arrival already reports that case; don't say it twice.
    assert wd.check_fact_sheet(None, None) == []


# --------------------------------------------------------------------------
# 3. integrity checks
# --------------------------------------------------------------------------


def test_integrity_all_green_is_silent():
    assert wd.check_integrity(integrity_rows(TODAY), TODAY) == []


def test_integrity_failure_is_named_in_the_message():
    rows = integrity_rows(TODAY, bad={"check_name": "missing_trading_days", "bad_rows": 12})
    findings = wd.check_integrity(rows, TODAY)
    assert [f.code for f in findings] == ["integrity_bad"]
    assert "missing_trading_days" in findings[0].text
    assert "12" in findings[0].text


def test_integrity_yesterday_is_still_fine():
    assert wd.check_integrity(integrity_rows(TODAY - timedelta(days=1)), TODAY) == []


def test_integrity_two_days_old_means_the_job_stopped():
    findings = wd.check_integrity(integrity_rows(TODAY - timedelta(days=2)), TODAY)
    assert [f.code for f in findings] == ["integrity_stale"]


def test_integrity_empty_table_alerts():
    assert [f.code for f in wd.check_integrity([], TODAY)] == ["integrity_missing"]


def test_integrity_only_judges_the_latest_run():
    # An old failure that has since been fixed must not keep alerting.
    rows = integrity_rows(TODAY - timedelta(days=1),
                          bad={"check_name": "nulls", "bad_rows": 5}) + integrity_rows(TODAY)
    assert wd.check_integrity(rows, TODAY) == []


# --------------------------------------------------------------------------
# 4. per-instrument health (data_health_report)
# --------------------------------------------------------------------------


def test_health_report_empty_means_healthy():
    assert wd.check_health_report([]) == []


def test_health_report_groups_by_issue():
    rows = [
        {"ticker": "SPY", "issue": "stale"},
        {"ticker": "QQQ", "issue": "stale"},
        {"ticker": "GLD", "issue": "error_streak"},
    ]
    findings = wd.check_health_report(rows)
    codes = sorted(f.code for f in findings)
    assert codes == ["health_error_streak", "health_stale"]
    assert all(f.level == wd.ALERT for f in findings)
    stale = next(f for f in findings if f.code == "health_stale")
    assert "QQQ" in stale.text and "SPY" in stale.text


def test_health_report_truncates_a_long_ticker_list():
    rows = [{"ticker": f"T{i:02d}", "issue": "stale"} for i in range(15)]
    text = wd.check_health_report(rows)[0].text
    assert "15 กอง" in text
    assert text.endswith("…")


# --------------------------------------------------------------------------
# 5. flagged prices -- a note, never an alert
# --------------------------------------------------------------------------


def test_flagged_empty_is_silent():
    assert wd.check_flagged([]) == []


def test_flagged_is_a_note_not_an_alert():
    findings = wd.check_flagged([{"ticker": "BNO", "status": "flagged"}])
    assert findings[0].level == wd.NOTE
    assert "BNO" in findings[0].text


def test_notes_alone_do_not_turn_the_message_into_a_warning():
    snap = healthy_snapshot()
    snap.flagged = [{"ticker": "BNO", "status": "flagged"}]
    message = wd.format_message(snap, wd.build_findings(snap, TODAY), NOW)
    assert message.startswith("✅")
    assert "BNO" in message


# --------------------------------------------------------------------------
# 6. quarterly classification
# --------------------------------------------------------------------------


def test_classification_fresh_quarter_is_reported_once_with_the_move_count():
    rows = classification_rows(date(2026, 10, 1), date(2026, 10, 2), moved=7)
    findings = wd.check_classification(rows, date(2026, 10, 5))
    assert [f.code for f in findings] == ["classification_new"]
    assert findings[0].level == wd.NOTE
    assert "ย้ายกลุ่ม 7 กอง" in findings[0].text


def test_classification_stops_being_news_after_a_week():
    rows = classification_rows(date(2026, 10, 1), date(2026, 10, 2), moved=7)
    assert wd.check_classification(rows, date(2026, 10, 20)) == []


def test_classification_missing_inside_the_grace_period_is_silent():
    rows = classification_rows(date(2026, 7, 1), date(2026, 7, 2))
    assert wd.check_classification(rows, date(2026, 10, 3)) == []


def test_classification_missing_after_the_grace_period_alerts():
    rows = classification_rows(date(2026, 7, 1), date(2026, 7, 2))
    findings = wd.check_classification(rows, date(2026, 10, 12))
    assert [f.code for f in findings] == ["classification_missing"]
    assert findings[0].level == wd.ALERT


def test_quarter_start():
    assert wd.quarter_start(date(2026, 11, 8)) == date(2026, 10, 1)
    assert wd.quarter_start(date(2026, 1, 1)) == date(2026, 1, 1)
    assert wd.quarter_start(date(2026, 6, 30)) == date(2026, 4, 1)


# --------------------------------------------------------------------------
# 7. FOMC calendar runway
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "days_left,level",
    [(400, None), (200, None), (150, wd.NOTE), (90, wd.NOTE), (60, wd.ALERT), (5, wd.ALERT)],
)
def test_fomc_runway_levels(days_left, level):
    findings = wd.check_fomc_runway(TODAY + timedelta(days=days_left), TODAY)
    if level is None:
        assert findings == []
    else:
        assert findings[0].level == level


def test_fomc_missing_alerts():
    assert [f.code for f in wd.check_fomc_runway(None, TODAY)] == ["fomc_missing"]


# --------------------------------------------------------------------------
# Message shape
# --------------------------------------------------------------------------


def test_alert_message_lists_every_alert():
    snap = healthy_snapshot()
    snap.facts_max = AS_OF - timedelta(days=1)
    snap.integrity = integrity_rows(TODAY, bad={"check_name": "nulls", "bad_rows": 3})
    message = wd.format_message(snap, wd.build_findings(snap, TODAY), NOW)
    assert message.startswith("⚠️")
    assert "fact sheet" in message
    assert "nulls" in message
    assert "9 พ.ย. 15:42 น." in message


def test_thai_date_formatting():
    assert wd.thai_date(date(2026, 11, 6)) == "6 พ.ย."
    assert wd.thai_date(date(2027, 12, 8), with_year=True) == "8 ธ.ค. 2027"
    assert wd.thai_date(None) == "ไม่มีข้อมูล"


def test_parse_helpers_accept_what_postgrest_returns():
    assert wd.parse_date("2026-11-06") == date(2026, 11, 6)
    assert wd.parse_date("2026-11-08T01:00:00.247453+00:00") == date(2026, 11, 8)
    assert wd.parse_date(date(2026, 11, 6)) == date(2026, 11, 6)
    assert wd.parse_date(None) is None
    assert wd.parse_dt("2026-11-08T01:00:00Z") == datetime(
        2026, 11, 8, 1, 0, tzinfo=timezone.utc
    )


# --------------------------------------------------------------------------
# notify.py
# --------------------------------------------------------------------------


def test_truncate_keeps_short_messages_untouched():
    assert notify.truncate("สั้น") == "สั้น"


def test_truncate_cuts_long_messages_below_the_telegram_limit():
    out = notify.truncate("x" * 5000)
    assert len(out) <= notify.MAX_MESSAGE_CHARS
    assert out.endswith("(ตัดข้อความ)")


def test_send_without_credentials_raises_rather_than_failing_silently(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    with pytest.raises(notify.NotifyError):
        notify.send("hello")
