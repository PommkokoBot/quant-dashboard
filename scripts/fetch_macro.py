#!/usr/bin/env python3
"""
Daily macro series fetch for Quant-Dashboard.

Reads the series list from config/macro_series.json (config-driven, per
architecture doc section 1.2) and upserts into `macro_series`.

FRED is fully implemented. Bank of Thailand (BOT) is NOT implemented yet --
this sandbox could not reach apiportal.bot.or.th to verify the real
endpoint/response schema, so rather than guess at it, `bot` is a documented
stub that raises NotImplementedError. This is a separate follow-up (see
config/macro_series.json "bot" block and the architecture doc open items),
not silently skipped.

Env vars required:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  FRED_API_KEY          free key from https://fred.stlouisfed.org/docs/api/api_key.html

Usage:
  python scripts/fetch_macro.py
  python scripts/fetch_macro.py --lookback-days 30
"""
import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import requests
from supabase import create_client

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "macro_series.json"
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"


def get_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.")
    return create_client(url, key)


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def fetch_fred_series(series_id: str, units: str, api_key: str, start_date: str):
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "units": units,
        "observation_start": start_date,
    }
    resp = requests.get(FRED_BASE, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    rows = []
    for obs in payload.get("observations", []):
        if obs["value"] in (".", "", None):
            continue  # FRED uses "." for missing observations
        rows.append({"series_id": series_id, "date": obs["date"], "value": float(obs["value"]), "source": "FRED"})
    return rows


def upsert_macro(client, rows):
    if not rows:
        return
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        client.table("macro_series").upsert(rows[i : i + CHUNK], on_conflict="series_id,date").execute()


def fetch_bot_series(*_args, **_kwargs):
    raise NotImplementedError(
        "Bank of Thailand macro fetch is not implemented yet. "
        "Needs: (1) a registered BOT Open Data API key, (2) confirming the real "
        "endpoint + response schema for policy rate / Thai CPI / GDP growth -- "
        "could not be verified from this sandbox (network to apiportal.bot.or.th "
        "is blocked here). See config/macro_series.json 'bot' block."
    )


def run(lookback_days: int):
    config = load_config()
    client = get_client()
    fred_key = os.environ.get("FRED_API_KEY")

    start_date = (date.today() - timedelta(days=lookback_days)).isoformat()
    ok, errored = 0, 0

    for series in config.get("fred", []):
        series_id = series["series_id"]
        if not fred_key:
            print("[ERROR] FRED_API_KEY not set -- skipping FRED series", file=sys.stderr)
            errored += 1
            break
        try:
            rows = fetch_fred_series(series_id, series.get("units", "lin"), fred_key, start_date)
            upsert_macro(client, rows)
            print(f"[ok]  {series_id} ({series.get('label', '')}): {len(rows)} rows")
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"[ERROR] {series_id}: {e}", file=sys.stderr)
            errored += 1

    bot_config = config.get("bot", {})
    if bot_config:
        print(f"[skip] BOT series: {bot_config.get('_status', 'not implemented')}")

    print(f"\nDone. ok={ok} errored={errored}")
    if errored:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback-days", type=int, default=10, help="Re-fetch observations from the last N days. Default 10.")
    args = parser.parse_args()
    run(args.lookback_days)
