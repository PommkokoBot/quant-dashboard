#!/usr/bin/env python3
"""
Daily OHLCV fetch for Quant-Dashboard.

Reads the active instrument universe from Supabase (`instruments` table,
is_active = true), pulls daily price history from Yahoo Finance via
`yfinance`, flags suspicious daily moves (> +-50%), and upserts into
`ohlcv_daily`. Designed to run on a daily GitHub Actions cron, but also
works as a one-off manual backfill with --full-history.

2026-09-15 additions:
  * Adjustment-basis check: Yahoo re-bases the WHOLE adjusted history every
    time a dividend (or split) happens. The incremental run only rewrites the
    last N days, so without this check a dividend paid after the last full
    download would silently vanish from total return. Each incremental fetch
    now compares close and adj_close/close on the overlapping days against
    what is stored; if they differ, that ticker's full history is re-pulled.
  * Health check at the end of every full run (data_health_report RPC): the
    job fails -- and GitHub e-mails the owner -- only when an instrument has
    errored on each of the last ERROR_STREAK_DAYS run days, or its prices are
    STALE_TRADING_DAYS or more trading days behind the rest of the table. A
    single transient error is logged but no longer fails the job on its own.

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

# Some tickers (mostly non-US index symbols such as "^XXXX.BK") reject
# yfinance's period="max" outright: "Period 'max' is invalid, must be one of: 1d, 5d".
# An explicit start date sidesteps that per-ticker period whitelist entirely -- Yahoo just
# returns whatever history actually exists from this date forward -- so full-history mode
# uses a fixed early start date instead of period="max", uniformly for every ticker type.
FULL_HISTORY_START = "1990-01-01"

# Alert thresholds (agreed 2026-09-15)
ERROR_STREAK_DAYS = 3
STALE_TRADING_DAYS = 3

# Relative difference on an overlapping day above which the stored and the
# freshly downloaded series are treated as being on different adjustment
# bases. Well above float/numeric round-trip noise (~1e-15) and well below
# the smallest real dividend adjustment (a 0.01% yield -> 1e-4).
BASIS_TOLERANCE = 2e-5


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


def get_stored_rows(client, instrument_id, start):
    """date -> (close, adj_close) already on file from `start` onwards."""
    out = {}
    page, offset = 1000, 0
    while True:
        resp = (
            client.table("ohlcv_daily")
            .select("date, close, adj_close")
            .eq("instrument_id", instrument_id)
            .gte("date", start)
            .order("date")
            .range(offset, offset + page - 1)
            .execute()
        )
        data = resp.data or []
        for r in data:
            out[str(r["date"])] = (r.get("close"), r.get("adj_close"))
        if len(data) < page:
            break
        offset += page
    return out


def _rel_diff(a, b):
    a, b = float(a), float(b)
    return abs(a - b) / max(abs(a), abs(b), 1e-12)


def detect_basis_change(stored: dict, df: pd.DataFrame, tolerance: float = BASIS_TOLERANCE):
    """Compares a fresh download with stored rows on the days both have.

    Returns None when they agree, otherwise a dict describing the first
    mismatch. Two independent signals:
      * close changed          -> a split re-scaled the (split-adjusted) close
      * adj_close/close changed -> a new dividend re-scaled the adjusted history
    Days where either side lacks a usable close are ignored.
    """
    for idx, r in df.iterrows():
        d = idx.date().isoformat() if hasattr(idx, "date") else str(idx)
        if d not in stored:
            continue
        s_close, s_adj = stored[d]
        n_close, n_adj = r.get("Close"), r.get("Adj Close")
        if s_close is None or s_adj is None or pd.isna(n_close) or pd.isna(n_adj):
            continue
        if float(s_close) <= 0 or float(n_close) <= 0:
            continue
        if _rel_diff(s_close, n_close) > tolerance:
            return {"date": d, "reason": "close", "stored": float(s_close), "new": float(n_close)}
        s_ratio = float(s_adj) / float(s_close)
        n_ratio = float(n_adj) / float(n_close)
        if _rel_diff(s_ratio, n_ratio) > tolerance:
            return {"date": d, "reason": "adjustment", "stored_ratio": s_ratio, "new_ratio": n_ratio}
    return None


def health_report(client, error_days: int = ERROR_STREAK_DAYS, stale_days: int = STALE_TRADING_DAYS):
    resp = client.rpc("data_health_report", {"p_error_days": error_days, "p_stale_days": stale_days}).execute()
    return resp.data or []


def format_health_issue(row) -> str:
    d = row.get("detail") or {}
    if row.get("issue") == "error_streak":
        return (f"{row.get('ticker')}: error {d.get('days')} run-days in a row "
                f"({d.get('first_day')} .. {d.get('last_day')}) -- last message: {d.get('last_message')}")
    if row.get("issue") == "stale":
        return (f"{row.get('ticker')}: prices stop at {d.get('last_date')}, "
                f"{d.get('trading_days_behind')} trading day(s) behind the latest date {d.get('latest_date_in_db')}")
    return f"{row.get('ticker')}: {row.get('issue')} {d}"


def fetch_yf_history(ticker: str, start: str | None, full_history: bool) -> pd.DataFrame:
    last_err = None
    effective_start = FULL_HISTORY_START if full_history else start
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            df = yf.download(ticker, start=effective_start, auto_adjust=False, progress=False)
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

    ok, flagged, errored, rebased = 0, 0, 0, 0
    for inst in instruments:
        instrument_id, ticker = inst["id"], inst["ticker"]
        try:
            df = fetch_yf_history(ticker, start, full_history)
            if df.empty:
                log_fetch(client, instrument_id, "error", "yfinance returned no rows")
                errored += 1
                continue

            basis = None
            if not full_history:
                stored = get_stored_rows(client, instrument_id, start)
                basis = detect_basis_change(stored, df)
                if basis:
                    # Re-pull everything so the whole adjusted series sits on
                    # ONE basis again (never splice two download dates).
                    df = fetch_yf_history(ticker, None, True)
                    rebased += 1
                    print(f"[rebase] {ticker}: {basis['reason']} changed on {basis['date']} -> full history re-pulled")

            use_full = full_history or basis is not None
            _, prior_close = (None, None) if use_full else get_last_close(client, instrument_id)
            rows, flags = build_rows_and_flags(instrument_id, df, prior_close)
            upsert_ohlcv(client, rows)

            note = f" (adjustment basis changed on {basis['date']} [{basis['reason']}] -> full history refreshed)" if basis else ""
            detail = {"basis_change": basis} if basis else None
            if flags:
                log_fetch(client, instrument_id, "flagged", f"{len(flags)} daily move(s) exceeded +-{int(SANITY_MOVE_THRESHOLD*100)}%{note}", {"flags": flags, **(detail or {})})
                flagged += 1
            else:
                log_fetch(client, instrument_id, "ok", f"{len(rows)} row(s) upserted{note}", detail)
                ok += 1
            print(f"[ok]  {ticker}: {len(rows)} rows" + (f" ({len(flags)} flagged)" if flags else ""))
        except Exception as e:  # noqa: BLE001
            log_fetch(client, instrument_id, "error", str(e))
            errored += 1
            print(f"[ERROR] {ticker}: {e}", file=sys.stderr)

    print(f"\nDone. ok={ok} flagged={flagged} errored={errored} rebased={rebased} total={len(instruments)}")

    if only_ticker:
        # debugging run: keep the old behaviour, fail on any error
        if errored:
            sys.exit(1)
        return

    try:
        issues = health_report(client)
    except Exception as e:  # noqa: BLE001
        print(f"::error::health check could not run: {e}")
        sys.exit(1)
    if issues:
        print(f"\nHEALTH CHECK FAILED -- {len(issues)} issue(s):")
        for row in issues:
            print(f"::error::{format_health_issue(row)}")
        sys.exit(1)  # failed job -> GitHub e-mails the workflow owner
    if errored:
        print(f"::warning::{errored} ticker(s) errored this run, but none for {ERROR_STREAK_DAYS} run-days in a row yet")
    print("Health check OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback-days", type=int, default=10, help="Re-fetch the last N days (self-healing window). Default 10.")
    parser.add_argument("--full-history", action="store_true", help="Pull max available history instead of the lookback window. Use for the first run / backfill.")
    parser.add_argument("--ticker", type=str, default=None, help="Only fetch this single ticker (debugging).")
    args = parser.parse_args()
    run(args.lookback_days, args.full_history, args.ticker)
