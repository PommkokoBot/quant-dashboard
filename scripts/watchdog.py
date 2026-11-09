#!/usr/bin/env python3
"""
Daily watchdog for Quant-Dashboard: asks the database what its state is and
reports to Telegram.

Why a separate job instead of a notification inside each existing workflow:
the failure we most need to catch is "the job never ran at all", and a
notification that lives inside that job cannot fire in exactly that case. This
one asks about *state* (is there a fact sheet for the latest trading day? were
yesterday's integrity checks green?) rather than reporting on its own run, so
an absence is visible.

It sends a short line every day even when everything is fine. That is on
purpose: a notifier that is silent when healthy is indistinguishable from a
notifier that is dead, so silence has to mean something.

Read-only. This script never writes to the database, and it deliberately
contains no trading-calendar logic of its own -- "what is the latest data date"
comes from data_as_of() and "which instruments are stale" from
data_health_report(), so there is no second implementation to drift
(tool-quant-dashboard.md rule 7.2).

Env vars required:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  TELEGRAM_BOT_TOKEN
  TELEGRAM_CHAT_ID

Usage:
  python scripts/watchdog.py              # check and send
  python scripts/watchdog.py --dry-run    # check and print, send nothing
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# Thresholds. Every one of these is a judgement call, so they live together
# here rather than being buried in the functions that use them.
# ---------------------------------------------------------------------------

# No new price rows at all for this many CALENDAR days is wrong under every
# holiday schedule: the longest run of consecutive non-trading days in the US
# is 4 (Fri holiday + weekend + Mon holiday has never happened, but Thu-Fri-Sat-Sun
# has). 5 is the first value that cannot produce a false alarm.
MAX_DATA_AGE_DAYS = 5

# integrity_log is written by pg_cron at 01:00 UTC daily. Two days without a
# row means the job itself stopped.
MAX_INTEGRITY_AGE_DAYS = 2

# quarterly-classification runs on days 1-5 of Jan/Apr/Jul/Oct. Give it a few
# days of slack before calling a missing quarter a problem.
CLASSIFICATION_GRACE_DAYS = 8

# Report a freshly computed quarter once, not every day for three months.
CLASSIFICATION_NEWS_DAYS = 7

# The FOMC calendar is curated by hand and has to be extended once a year.
FOMC_NOTE_DAYS = 183
FOMC_ALERT_DAYS = 61

BANGKOK = timezone(timedelta(hours=7))

THAI_MONTHS = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
]

ALERT = "alert"
NOTE = "note"


@dataclass(frozen=True)
class Finding:
    level: str
    code: str
    text: str


@dataclass
class Snapshot:
    """Everything read from the database, before any judgement is applied."""

    as_of: date | None = None                      # data_as_of()['as_of']
    facts_max: date | None = None                  # max(daily_facts.trade_date)
    integrity: list[dict] = field(default_factory=list)      # run_day/check_name/status/bad_rows
    health_issues: list[dict] = field(default_factory=list)  # data_health_report() rows
    flagged: list[dict] = field(default_factory=list)        # non-ok rows of the latest fetch run
    classification: list[dict] = field(default_factory=list) # latest quarter's rows
    fomc_last: date | None = None                  # max(market_events.event_date) for fomc


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def thai_date(value: date | None, with_year: bool = False) -> str:
    if value is None:
        return "ไม่มีข้อมูล"
    text = f"{value.day} {THAI_MONTHS[value.month - 1]}"
    return f"{text} {value.year}" if with_year else text


def parse_date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    return date.fromisoformat(str(value)[:10])


def parse_dt(value) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    return datetime.fromisoformat(text)


def quarter_start(day: date) -> date:
    return date(day.year, ((day.month - 1) // 3) * 3 + 1, 1)


# ---------------------------------------------------------------------------
# The checks. Pure functions: data in, findings out. No I/O, no clock.
# ---------------------------------------------------------------------------


def check_data_arrival(as_of: date | None, today: date) -> list[Finding]:
    if as_of is None:
        return [Finding(ALERT, "no_data", "ไม่มีข้อมูลราคาในฐานข้อมูลเลย")]
    age = (today - as_of).days
    if age >= MAX_DATA_AGE_DAYS:
        return [
            Finding(
                ALERT,
                "data_stale",
                f"ไม่มีข้อมูลราคาเข้ามา {age} วันแล้ว (ล่าสุด {thai_date(as_of)})",
            )
        ]
    return []


def check_fact_sheet(facts_max: date | None, as_of: date | None) -> list[Finding]:
    if as_of is None:
        return []  # already reported by check_data_arrival
    if facts_max is None:
        return [Finding(ALERT, "no_facts", "ไม่มี fact sheet เลยสักแผ่น")]
    if facts_max < as_of:
        behind = (as_of - facts_max).days
        return [
            Finding(
                ALERT,
                "facts_behind",
                f"ยังไม่มี fact sheet ของวันที่ {thai_date(as_of)} "
                f"(แผ่นล่าสุด {thai_date(facts_max)} ช้า {behind} วัน)",
            )
        ]
    return []


def check_integrity(rows: list[dict], today: date) -> list[Finding]:
    if not rows:
        return [Finding(ALERT, "integrity_missing", "ไม่มีผลตรวจความถูกต้องเลย")]

    days = [parse_date(r.get("run_at")) for r in rows]
    latest = max(d for d in days if d is not None)
    age = (today - latest).days
    if age >= MAX_INTEGRITY_AGE_DAYS:
        return [
            Finding(
                ALERT,
                "integrity_stale",
                f"ด่านความถูกต้องไม่ได้รันมา {age} วัน (ครั้งล่าสุด {thai_date(latest)})",
            )
        ]

    latest_rows = [r for r, d in zip(rows, days) if d == latest]
    bad = [r for r in latest_rows if r.get("status") != "ok"]
    if bad:
        detail = " · ".join(
            f"{r.get('check_name')} {r.get('bad_rows')} แถว" for r in bad
        )
        return [Finding(ALERT, "integrity_bad", f"ด่านความถูกต้องไม่ผ่าน: {detail}")]
    return []


def check_health_report(rows: list[dict]) -> list[Finding]:
    """data_health_report() returns ONLY problems, so any row is a problem."""
    if not rows:
        return []
    by_issue: dict[str, list[str]] = {}
    for row in rows:
        by_issue.setdefault(str(row.get("issue")), []).append(str(row.get("ticker")))
    label = {"error_streak": "ดึงข้อมูลล้มติดกัน", "stale": "ข้อมูลค้าง"}
    findings = []
    for issue, tickers in sorted(by_issue.items()):
        name = label.get(issue, issue)
        findings.append(
            Finding(
                ALERT,
                f"health_{issue}",
                f"{name} {len(tickers)} กอง: {', '.join(sorted(tickers)[:10])}"
                + (" …" if len(tickers) > 10 else ""),
            )
        )
    return findings


def check_flagged(rows: list[dict]) -> list[Finding]:
    """A flagged row is a >±50% daily move: worth a look, not a breakage."""
    if not rows:
        return []
    tickers = sorted({str(r.get("ticker")) for r in rows})
    return [
        Finding(
            NOTE,
            "flagged",
            f"ราคาผิดปกติถูก flag {len(tickers)} กอง: {', '.join(tickers[:10])}"
            + (" …" if len(tickers) > 10 else ""),
        )
    ]


def check_classification(rows: list[dict], today: date) -> list[Finding]:
    expected = quarter_start(today)
    quarters = [parse_date(r.get("as_of_quarter")) for r in rows]
    latest = max((q for q in quarters if q is not None), default=None)

    if latest is None or latest < expected:
        if (today - expected).days >= CLASSIFICATION_GRACE_DAYS:
            return [
                Finding(
                    ALERT,
                    "classification_missing",
                    f"ยังไม่มีการจัดกลุ่มของไตรมาส {thai_date(expected)} "
                    f"(ล่าสุด {thai_date(latest, with_year=True)})",
                )
            ]
        return []

    latest_rows = [r for r, q in zip(rows, quarters) if q == latest]
    computed = [parse_dt(r.get("computed_at")) for r in latest_rows]
    newest = max((c for c in computed if c is not None), default=None)
    if newest is None or (today - newest.date()).days > CLASSIFICATION_NEWS_DAYS:
        return []  # not news any more

    moved = [
        r
        for r in latest_rows
        if r.get("prev_bucket") and r.get("bucket") != r.get("prev_bucket")
    ]
    return [
        Finding(
            NOTE,
            "classification_new",
            f"จัดกลุ่มไตรมาส {thai_date(latest)} แล้ว: {len(latest_rows)} กอง "
            f"· ย้ายกลุ่ม {len(moved)} กอง",
        )
    ]


def check_fomc_runway(last_fomc: date | None, today: date) -> list[Finding]:
    if last_fomc is None:
        return [Finding(ALERT, "fomc_missing", "ไม่มีปฏิทิน FOMC ในฐานข้อมูล")]
    days_left = (last_fomc - today).days
    if days_left <= FOMC_ALERT_DAYS:
        level = ALERT
    elif days_left <= FOMC_NOTE_DAYS:
        level = NOTE
    else:
        return []
    return [
        Finding(
            level,
            "fomc_runway",
            f"ปฏิทิน FOMC เหลืออีก {days_left} วัน (ถึง {thai_date(last_fomc, with_year=True)}) "
            f"— ต้องเติมปีถัดไป",
        )
    ]


def build_findings(snapshot: Snapshot, today: date) -> list[Finding]:
    findings: list[Finding] = []
    findings += check_data_arrival(snapshot.as_of, today)
    findings += check_fact_sheet(snapshot.facts_max, snapshot.as_of)
    findings += check_integrity(snapshot.integrity, today)
    findings += check_health_report(snapshot.health_issues)
    findings += check_flagged(snapshot.flagged)
    findings += check_classification(snapshot.classification, today)
    findings += check_fomc_runway(snapshot.fomc_last, today)
    return findings


def integrity_summary(rows: list[dict]) -> str:
    if not rows:
        return "ความถูกต้อง —"
    days = [parse_date(r.get("run_at")) for r in rows]
    latest = max((d for d in days if d is not None), default=None)
    latest_rows = [r for r, d in zip(rows, days) if d == latest]
    ok = sum(1 for r in latest_rows if r.get("status") == "ok")
    return f"ความถูกต้อง {ok}/{len(latest_rows)}"


def format_message(snapshot: Snapshot, findings: list[Finding], now: datetime) -> str:
    today = now.date()
    alerts = [f for f in findings if f.level == ALERT]
    notes = [f for f in findings if f.level == NOTE]
    stamp = f"{thai_date(today)} {now.strftime('%H:%M')} น."

    if not alerts:
        facts_ok = snapshot.facts_max is not None and snapshot.as_of == snapshot.facts_max
        line = (
            f"✅ {stamp} · ข้อมูล {thai_date(snapshot.as_of)} · "
            f"{'fact sheet ครบ' if facts_ok else 'fact sheet ไม่ครบ'} · "
            f"{integrity_summary(snapshot.integrity)} · flagged {len(snapshot.flagged)}"
        )
        if notes:
            line += "\n\n" + "\n".join(f"ℹ️ {n.text}" for n in notes)
        return line

    parts = [f"⚠️ Quant Dashboard — {stamp}", ""]
    parts += [f"• {a.text}" for a in alerts]
    if notes:
        parts += [""] + [f"ℹ️ {n.text}" for n in notes]
    parts += ["", f"ข้อมูลล่าสุดในฐานข้อมูล {thai_date(snapshot.as_of)}"]
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Reading the database (the only impure part)
# ---------------------------------------------------------------------------


def read_snapshot(client) -> Snapshot:
    snapshot = Snapshot()

    as_of_payload = client.rpc("data_as_of", {}).execute().data or {}
    if isinstance(as_of_payload, list):  # PostgREST returns a bare value or a list
        as_of_payload = as_of_payload[0] if as_of_payload else {}
    snapshot.as_of = parse_date(as_of_payload.get("as_of"))

    snapshot.health_issues = client.rpc("data_health_report", {}).execute().data or []

    facts = (
        client.table("daily_facts")
        .select("trade_date")
        .order("trade_date", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    snapshot.facts_max = parse_date(facts[0]["trade_date"]) if facts else None

    snapshot.integrity = (
        client.table("integrity_log")
        .select("run_at,check_name,status,bad_rows")
        .order("run_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )

    last_fetch = (
        client.table("fetch_log")
        .select("run_at")
        .order("run_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if last_fetch:
        day = parse_date(last_fetch[0]["run_at"])
        rows = (
            client.table("fetch_log")
            .select("run_at,status,message,instruments(ticker)")
            .neq("status", "ok")
            .gte("run_at", day.isoformat())
            .limit(50)
            .execute()
            .data
            or []
        )
        snapshot.flagged = [
            {"ticker": (r.get("instruments") or {}).get("ticker"), "status": r.get("status")}
            for r in rows
        ]

    snapshot.classification = (
        client.table("instrument_classification")
        .select("as_of_quarter,computed_at,bucket,prev_bucket")
        .order("as_of_quarter", desc=True)
        .limit(200)
        .execute()
        .data
        or []
    )

    fomc = (
        client.table("market_events")
        .select("event_date")
        .eq("event_type", "fomc")
        .order("event_date", desc=True)
        .limit(1)
        .execute()
        .data
    )
    snapshot.fomc_last = parse_date(fomc[0]["event_date"]) if fomc else None

    return snapshot


def get_client():
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    return create_client(url, key)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check dashboard health and report.")
    parser.add_argument(
        "--dry-run", action="store_true", help="print the message instead of sending"
    )
    args = parser.parse_args()

    now = datetime.now(BANGKOK)
    snapshot = read_snapshot(get_client())
    findings = build_findings(snapshot, now.date())
    message = format_message(snapshot, findings, now)

    print(message)
    if args.dry_run:
        return 0

    from notify import NotifyError, send

    try:
        send(message)
    except NotifyError as exc:
        # Failing the step makes GitHub e-mail the owner -- the backstop for a
        # notifier that cannot notify.
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())
