#!/usr/bin/env python3
"""
Daily OHLCV fetch for Quant-Dashboard.

Reads the active instrument universe from Supabase (`instruments` table,
is_active = true), pulls daily price history from Yahoo Finance via
`yfinance`, flags suspicious daily moves (> +-50%), and upserts into
`ohlcv_daily`. Designed to run on a daily GitHub Actions cron, but also
works as a one-off manual backfill with --full-history.

Env vars required:
  SUPABASE_URL                 e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    service role key (bypasses RLS) -- NEVER commit this

Usage:
  python scripts/fetch_prices.py                  # incremental: last 10 trading days
  python scripts/fetch_prices.py --lookback-days 30
  python scripts/fetch_prices.py --full-history    # pull max available history (first run / backfill)
  python scripts/fetch_prices.py --ticker SPY      # single ticker, for debugging
"""
import argparse
import os
import sys
import time
from datetime import date, timedelta

import pandas as pd
import yfinance as yf
from supabase import create_client

SANITY_MOVE_THRESHOLD = 0.50  # +-50% daily move triggers a 'flagged' fetch_log entry
RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 5


def get_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.")
    return create_client(url, key)


def get_active_instruments(client):
    resp = client.table("instruments").select("id, ticker").eq("is_active", True).execute()
    return resp.data


def get_last_close(client, instrument_id):
    """Latest adj_close already on file for this instrument, used to sanity-check the
    first new row of a fetch window against what's already stored (boundary case)."""
    resp = (
        client.table("ohlcv_daily")
        .select("date, adj_close")
        .eq("instrument_id", instrument_id)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    if resp.data:
        return resp.data[0]["date"], resp.data[0]["adj_close"]
    return None, None


def fetch_yf_history(ticker: str, start: str | None, full_history: bool) -> pd.DataFrame:
    last_err = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            if full_history:
                df = yf.download(ticker, period="max", auto_adjust=False, progress=False)
            else:
                df = yf.download(ticker, start=start, auto_adjust=False, progress=False)
            # yfinance >= 0.2 returns a MultiIndex column frame even for a single ticker
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            return df
        except Exception as e:  # noqa: BLE001 - yfinance raises a mix of exception types
            last_err = e
            if attempt < RETRY_ATTEMPTS:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)
    raise RuntimeError(f"yfinance fetch failed for {ticker} after {RETRY_ATTEMPTS} attempts: {last_err}")


def build_rows_and_flags(instrument_id: int, df: pd.DataFrame, prior_close: float | None):
    """Turns a yfinance dataframe into ohlcv_daily rows, and returns any
    daily moves that exceed SANITY_MOVE_THRESHOLD for fetch_log."""
    rows = []
    flags = []
    prev = prior_close
    for idx, r in df.iterrows():
        d = idx.date().isoformat() if hasattr(idx, "date") else str(idx)
        adj_close = r.get("Adj Close")
        close = r.get("Close")
        if pd.isna(adj_close):
            continue  # no usable price for this row -- skip rather than write nulls
        rows.append(
            {
                "instrument_id": instrument_id,
                "date": d,
                "open": _clean(r.get("Open")),
                "high": _clean(r.get("High")),
                "low": _clean(r.get("Low")),
                "close": _clean(close),
                "adj_close": float(adj_close),
                "volume": _clean_int(r.get("Volume")),
            }
        )
        if prev is not None and prev != 0:
            move = float(adj_close) / float(prev) - 1
            if abs(move) > SANITY_MOVE_THRESHOLD:
                flags.append({"date": d, "move_pct": round(move * 100, 2), "prev_close": prev, "adj_close": float(adj_close)})
        prev = float(adj_close)
    return rows, flags


def _clean(v):
    return None if pd.isna(v) else float(v)


def _clean_int(v):
    return None if pd.isna(v) else int(v)


def upsert_ohlcv(client, rows):
    if not rows:
        return
    # chunk to keep individual requests reasonably sized
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i : i + CHUNK]
        client.table("ohlcv_daily").upsert(chunk, on_conflict="instrument_id,date").execute()


def log_fetch(client, instrument_id, status, message=None, detail=None):
    client.table("fetch_log").insert(
        {"instrument_id": instrument_id, "status": status, "message": message, "detail": detail}
    ).execute()


def run(lookback_days: int, full_history: bool, only_ticker: str | None):
    client = get_client()
    instruments = get_active_instruments(client)
    if only_ticker:
        instruments = [i for i in instruments if i["ticker"] == only_ticker]
        if not instruments:
            sys.exit(f"Ticker {only_ticker} not found in instruments table (or not active).")

    start = None if full_history else (date.today() - timedelta(days=lookback_days)).isoformat()

    ok, flagged, errored = 0, 0, 0
    for inst in instruments:
        instrument_id, ticker = inst["id"], inst["ticker"]
        try:
            df = fetch_yf_history(ticker, start, full_history)
            if df.empty:
                log_fetch(client, instrument_id, "error", "yfinance returned no rows")
                errored += 1
                continue

            _, prior_close = (None, None) if full_history else get_last_close(client, instrument_id)
            rows, flags = build_rows_and_flags(instrument_id, df, prior_close)
            upsert_ohlcv(client, rows)

            if flags:
                log_fetch(client, instrument_id, "flagged", f"{len(flags)} daily move(s) exceeded +-{int(SANITY_MOVE_THRESHOLD*100)}%", {"flags": flags})
                flagged += 1
            else:
                log_fetch(client, instrument_id, "ok", f"{len(rows)} row(s) upserted")
                ok += 1
            print(f"[ok]  {ticker}: {len(rows)} rows" + (f" ({len(flags)} flagged)" if flags else ""))
        except Exception as e:  # noqa: BLE001
            log_fetch(client, instrument_id, "error", str(e))
            errored += 1
            print(f"[ERROR] {ticker}: {e}", file=sys.stderr)

    print(f"\nDone. ok={ok} flagged={flagged} errored={errored} total={len(instruments)}")
    if errored:
        sys.exit(1)  # non-zero exit -> GitHub Actions run shows as failed, easy to notice


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback-days", type=int, default=10, help="Re-fetch the last N days (self-healing window). Default 10.")
    parser.add_argument("--full-history", action="store_true", help="Pull max available history instead of the lookback window. Use for the first run / backfill.")
    parser.add_argument("--ticker", type=str, default=None, help="Only fetch this single ticker (debugging).")
    args = parser.parse_args()
    run(args.lookback_days, args.full_history, args.ticker)
