#!/usr/bin/env python3
"""
Market event calendar sync (2026-09-21).

For every event type in config/events.json whose source is fred / rule / curated,
build the complete list of event dates and make market_events equal to it
(add missing dates, remove dates the source no longer has). Types with source
'manual' (the Round 2 admin page) are never touched.

  fred    : FRED release dates, including scheduled future ones
            (fred/release/dates, include_release_dates_with_no_data=true).
            A release is REFUSED -- nothing written for it -- if any calendar
            year has more than fred_max_per_year dates: that means FRED's list
            holds revision/vintage days rather than one entry per release
            (this is exactly what FRED's "FOMC Press Release" list looks like,
            which is why FOMC is curated instead).
  rule    : computed (US elections, monthly option expiry).
  curated : config/events_curated.json (FOMC, from the Federal Reserve's calendars).

Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRED_API_KEY (fred types only)

Usage:
  python scripts/fetch_events.py             # sync
  python scripts/fetch_events.py --dry-run   # build + report the diff, write nothing
"""
import argparse
import json
import os
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "events.json"
CURATED_PATH = ROOT / "config" / "events_curated.json"
FRED_RELEASE_DATES = "https://api.stlouisfed.org/fred/release/dates"
OWNED_SOURCES = ("fred", "rule", "curated")
TYPE_FIELDS = ("code", "name_th", "name_en", "category", "source", "nontrading_shift",
               "show_default", "sort_order", "source_note")


# ---------------------------------------------------------------------------
# Rules (pure)
# ---------------------------------------------------------------------------
def easter_sunday(year: int) -> date:
    """Anonymous Gregorian algorithm (Meeus/Jones/Butcher)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def us_election_day(year: int) -> date:
    """Tuesday after the first Monday of November (always 2-8 November)."""
    nov1 = date(year, 11, 1)
    first_monday = nov1 + timedelta(days=(7 - nov1.weekday()) % 7)
    return first_monday + timedelta(days=1)


def third_friday(year: int, month: int) -> date:
    d1 = date(year, month, 1)
    first_friday = d1 + timedelta(days=(4 - d1.weekday()) % 7)
    return first_friday + timedelta(days=14)


def monthly_opex(year: int, month: int) -> date:
    """Third Friday; the Thursday before when that Friday is an exchange holiday.
    Only Good Friday and Juneteenth (observed from 2022) can fall on a third
    Friday (days 15-21). Rare one-off closures in the past are handled by the
    'prev' trading-day shift in market_events_between()."""
    d = third_friday(year, month)
    good_friday = easter_sunday(year) - timedelta(days=2)
    juneteenth = year >= 2022 and d == date(year, 6, 19)
    if d == good_friday or juneteenth:
        d -= timedelta(days=1)
    return d


def rule_dates(rule: str, start_year: int, end_year: int) -> list:
    out = []
    for y in range(start_year, end_year + 1):
        if rule == "us_election_presidential" and y % 4 == 0:
            out.append(us_election_day(y))
        elif rule == "us_election_midterm" and y % 4 == 2:
            out.append(us_election_day(y))
        elif rule == "monthly_opex":
            out.extend(monthly_opex(y, m) for m in range(1, 13))
    if not out and rule not in ("us_election_presidential", "us_election_midterm", "monthly_opex"):
        raise ValueError(f"unknown rule '{rule}'")
    return out


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------
def fetch_fred_release_dates(release_id: int, api_key: str) -> list:
    params = {
        "release_id": release_id,
        "api_key": api_key,
        "file_type": "json",
        "include_release_dates_with_no_data": "true",
        "sort_order": "asc",
        "limit": 10000,
    }
    resp = requests.get(FRED_RELEASE_DATES, params=params, timeout=30)
    resp.raise_for_status()
    return sorted({date.fromisoformat(r["date"]) for r in resp.json().get("release_dates", [])})


def check_fred_dates(dates: list, max_per_year: int):
    """(ok, reason). One entry per release means at most ~12-14 dates a year."""
    if not dates:
        return False, "FRED returned no release dates"
    per_year = Counter(d.year for d in dates)
    worst_year, worst = max(per_year.items(), key=lambda kv: kv[1])
    if worst > max_per_year:
        return False, (f"{worst} dates in {worst_year} (> {max_per_year}) -- the list holds "
                       "revision/vintage days, not one entry per release")
    return True, ""


def load_curated(code: str, path: Path = CURATED_PATH):
    data = json.loads(path.read_text())
    block = data.get(code)
    if not block:
        raise ValueError(f"no curated block '{code}' in {path.name}")
    return sorted({date.fromisoformat(s) for s in block["dates"]}), block.get("notes", {})


def build_type_dates(t: dict, cfg: dict, today: date, fred_key):
    """Returns (dates, notes dict, error or None) for one owned type."""
    src = t["source"]
    if src == "rule":
        return rule_dates(t["rule"], cfg["rule_start_year"], today.year + cfg["rule_years_ahead"]), {}, None
    if src == "curated":
        dates, notes = load_curated(t["code"])
        return dates, notes, None
    if src == "fred":
        if not fred_key:
            return [], {}, "FRED_API_KEY not set"
        dates = fetch_fred_release_dates(t["fred_release_id"], fred_key)
        ok, reason = check_fred_dates(dates, cfg["fred_max_per_year"])
        return (dates, {}, None) if ok else ([], {}, reason)
    raise ValueError(f"source '{src}' is not script-owned")


def diff_dates(existing: set, wanted: set):
    return sorted(wanted - existing), sorted(existing - wanted)


def summarize(code: str, dates: list, today: date) -> str:
    if not dates:
        return f"{code}: 0 dates"
    past = [d for d in dates if d <= today]
    future = [d for d in dates if d > today]
    per_year = Counter(d.year for d in dates)
    return (f"{code}: {len(dates)} dates {dates[0]} .. {dates[-1]}; last past {past[-1] if past else '-'}; "
            f"next {future[0] if future else '-'}; max/year {max(per_year.values())}")


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def get_client():
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.")
    return create_client(url, key)


def existing_dates(client, code: str) -> set:
    out, page, offset = set(), 1000, 0
    while True:
        data = (client.table("market_events").select("event_date").eq("event_type", code)
                .order("event_date").range(offset, offset + page - 1).execute().data or [])
        out.update(date.fromisoformat(r["event_date"]) for r in data)
        if len(data) < page:
            return out
        offset += page


def upsert_types(client, types: list):
    rows = [{k: t.get(k) for k in TYPE_FIELDS} for t in types]
    client.table("event_types").upsert(rows, on_conflict="code").execute()


def write_type(client, code: str, source: str, wanted: list, remove: list, notes: dict):
    # every wanted row is upserted (not only new ones) so a changed note/source is refreshed
    rows = [{"event_type": code, "event_date": d.isoformat(), "source": source,
             "note": notes.get(d.isoformat())} for d in wanted]
    for i in range(0, len(rows), 500):
        client.table("market_events").upsert(rows[i:i + 500], on_conflict="event_type,event_date").execute()
    rm = [d.isoformat() for d in remove]
    for i in range(0, len(rm), 200):
        client.table("market_events").delete().eq("event_type", code).in_("event_date", rm[i:i + 200]).execute()


def run(dry_run: bool, client=None, today: date = None, config: dict = None, fred_key=None):
    cfg = config or json.loads(CONFIG_PATH.read_text())
    today = today or date.today()
    fred_key = fred_key if fred_key is not None else os.environ.get("FRED_API_KEY")
    client = client or get_client()
    owned = [t for t in cfg["types"] if t["source"] in OWNED_SOURCES]
    if not dry_run:
        upsert_types(client, cfg["types"])
    failed = 0
    for t in owned:
        code = t["code"]
        try:
            dates, notes, err = build_type_dates(t, cfg, today, fred_key)
        except Exception as e:  # noqa: BLE001
            dates, notes, err = [], {}, str(e)
        if err:
            print(f"::error::{code}: {err} -- nothing written for this type")
            failed += 1
            continue
        have = existing_dates(client, code)
        add, remove = diff_dates(have, set(dates))
        print(f"[{'dry-run' if dry_run else 'ok'}] {summarize(code, dates, today)}; +{len(add)} -{len(remove)}"
              + (f" (removing {', '.join(d.isoformat() for d in remove[:5])}{'...' if len(remove) > 5 else ''})" if remove else ""))
        if not dry_run:
            write_type(client, code, t["source"], sorted(set(dates)), remove, notes)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    run(args.dry_run)
