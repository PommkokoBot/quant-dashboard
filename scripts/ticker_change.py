#!/usr/bin/env python3
"""
Re-point instruments whose ticker was changed by the issuer (2026-09-15).

For every entry in config/ticker_changes.json:
  1. download the FULL history of the new ticker from Yahoo;
  2. check it is the same fund: on days both series have, the raw `close`
     (split-adjusted, NOT dividend-adjusted) must match -- adj_close is
     expected to differ because Yahoo re-bases it whenever a dividend is paid;
  3. write:
       * new history covers the stored history -> replace the whole series
         (one adjustment basis), deleting stored days Yahoo no longer has;
       * new history starts later -> ratio splice: keep the stored rows before
         the join date with adj_close scaled by new_adj/stored_adj on that day
         (daily returns of the old part are unchanged, no jump at the join),
         and take everything from the join date on from the new download;
  4. rename the instrument (ticker + name) and log to fetch_log.

Nothing is written for an entry that fails verification -- the script
reports why and exits non-zero. A backup of the pre-change rows is kept in
public.ohlcv_backup_ticker_change.

Usage:
  python scripts/ticker_change.py                 # verify + apply
  python scripts/ticker_change.py --dry-run       # verify + report only
"""
import argparse
import json
import sys
from pathlib import Path

import pandas as pd

import fetch_prices as fp

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "ticker_changes.json"

MIN_OVERLAP_DAYS = 20          # need at least this many common days to call it the same fund
MAX_MEDIAN_CLOSE_DIFF = 0.002  # median relative close difference allowed (0.2%)
MAX_BAD_DAY_SHARE = 0.05       # share of common days allowed to differ by more than 1%
COVER_SLACK_DAYS = 7           # new history "covers" the stored one if it starts within this many days


def load_stored(client, instrument_id):
    out = []
    page, offset = 1000, 0
    while True:
        resp = (
            client.table("ohlcv_daily")
            .select("date, close, adj_close")
            .eq("instrument_id", instrument_id)
            .order("date")
            .range(offset, offset + page - 1)
            .execute()
        )
        data = resp.data or []
        out.extend(data)
        if len(data) < page:
            break
        offset += page
    df = pd.DataFrame(out, columns=["date", "close", "adj_close"])
    if not df.empty:
        df["date"] = df["date"].astype(str)
        df["close"] = pd.to_numeric(df["close"], errors="coerce")
        df["adj_close"] = pd.to_numeric(df["adj_close"], errors="coerce")
    return df


def new_frame(instrument_id, yf_df):
    rows, _ = fp.build_rows_and_flags(instrument_id, yf_df, None)
    return rows, pd.DataFrame(rows, columns=["instrument_id", "date", "open", "high", "low", "close", "adj_close", "volume"])


def verify_same_fund(stored: pd.DataFrame, new: pd.DataFrame):
    """Returns (ok, report dict). Compares raw close on common days."""
    m = stored.merge(new[["date", "close", "adj_close"]], on="date", suffixes=("_old", "_new"))
    m = m.dropna(subset=["close_old", "close_new"])
    m = m[(m.close_old > 0) & (m.close_new > 0)]
    report = {"overlap_days": int(len(m))}
    if len(m) < MIN_OVERLAP_DAYS:
        report["reason"] = f"only {len(m)} common days (< {MIN_OVERLAP_DAYS}) -- cannot confirm it is the same fund"
        return False, report
    rel = (m.close_new - m.close_old).abs() / m.close_old
    report["median_close_diff"] = float(rel.median())
    report["share_days_over_1pct"] = float((rel > 0.01).mean())
    report["overlap_first"] = str(m.date.min())
    report["overlap_last"] = str(m.date.max())
    if report["median_close_diff"] > MAX_MEDIAN_CLOSE_DIFF or report["share_days_over_1pct"] > MAX_BAD_DAY_SHARE:
        report["reason"] = "raw close does not match on common days (different fund, or a split since the stored download)"
        return False, report
    return True, report


def plan_write(instrument_id, stored: pd.DataFrame, new_rows: list, new: pd.DataFrame):
    """Decides replace vs ratio splice. Returns (mode, rows_to_upsert, dates_to_delete, info)."""
    new_first = pd.Timestamp(new.date.min())
    stored_first = pd.Timestamp(stored.date.min())
    new_dates = set(new.date)
    if new_first <= stored_first + pd.Timedelta(days=COVER_SLACK_DAYS):
        to_delete = sorted(set(stored.date) - new_dates)
        return "replace", new_rows, to_delete, {"new_first": str(new.date.min())}

    common = sorted(set(stored.date) & new_dates)
    join = None
    for d in common:
        s_adj = stored.loc[stored.date == d, "adj_close"].iloc[0]
        n_adj = new.loc[new.date == d, "adj_close"].iloc[0]
        if pd.notna(s_adj) and pd.notna(n_adj) and s_adj > 0 and n_adj > 0:
            join = d
            factor = float(n_adj) / float(s_adj)
            break
    if join is None:
        raise ValueError("no usable common day to splice on")
    old_part = stored[stored.date < join]
    spliced = [
        {"instrument_id": instrument_id, "date": r.date, "adj_close": float(r.adj_close) * factor}
        for r in old_part.itertuples()
        if pd.notna(r.adj_close)
    ]
    new_part = [r for r in new_rows if r["date"] >= join]
    to_delete = sorted(set(stored.date[stored.date >= join]) - new_dates)
    return "splice", spliced + new_part, to_delete, {"join_date": join, "factor": factor, "old_rows_rescaled": len(spliced)}


def upsert_partial(client, rows):
    """Upsert that tolerates rows carrying only instrument_id/date/adj_close (splice part)."""
    full = [r for r in rows if "close" in r]
    part = [r for r in rows if "close" not in r]
    fp.upsert_ohlcv(client, full)
    for i in range(0, len(part), 500):
        client.table("ohlcv_daily").upsert(part[i:i + 500], on_conflict="instrument_id,date").execute()


def delete_dates(client, instrument_id, dates):
    for i in range(0, len(dates), 200):
        client.table("ohlcv_daily").delete().eq("instrument_id", instrument_id).in_("date", dates[i:i + 200]).execute()


def process(client, change, dry_run):
    iid, old, new_t = change["instrument_id"], change["old_ticker"], change["new_ticker"]
    cur = client.table("instruments").select("id, ticker, name").eq("id", iid).execute().data
    if not cur:
        return False, f"{old}->{new_t}: instrument {iid} not found"
    if cur[0]["ticker"] == new_t:
        return True, f"{old}->{new_t}: already renamed, skipped"
    if cur[0]["ticker"] != old:
        return False, f"{old}->{new_t}: instrument {iid} is '{cur[0]['ticker']}', expected '{old}' -- refusing"

    yf_df = fp.fetch_yf_history(new_t, None, True)
    if yf_df.empty:
        return False, f"{old}->{new_t}: Yahoo returned no rows for {new_t}"
    new_rows, new = new_frame(iid, yf_df)
    stored = load_stored(client, iid)
    if stored.empty:
        return False, f"{old}->{new_t}: no stored rows to verify against"

    ok, report = verify_same_fund(stored, new)
    if not ok:
        return False, f"{old}->{new_t}: VERIFICATION FAILED {json.dumps(report)}"

    mode, rows, to_delete, info = plan_write(iid, stored, new_rows, new)
    summary = {"mode": mode, **info, **report, "rows_upserted": len(rows), "rows_deleted": len(to_delete),
               "new_history": [str(new.date.min()), str(new.date.max())],
               "stored_history": [str(stored.date.min()), str(stored.date.max())]}
    if dry_run:
        return True, f"{old}->{new_t}: DRY RUN would {json.dumps(summary)}"

    upsert_partial(client, rows)
    delete_dates(client, iid, to_delete)
    client.table("instruments").update({"ticker": new_t, "name": change["new_name"]}).eq("id", iid).execute()
    fp.log_fetch(client, iid, "ok", f"ticker change {old} -> {new_t} ({mode})", summary)
    return True, f"{old}->{new_t}: APPLIED {json.dumps(summary)}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--config", default=str(CONFIG_PATH))
    args = ap.parse_args()
    changes = json.loads(Path(args.config).read_text())["changes"]
    client = fp.get_client()
    failed = 0
    for ch in changes:
        try:
            ok, msg = process(client, ch, args.dry_run)
        except Exception as e:  # noqa: BLE001
            ok, msg = False, f"{ch.get('old_ticker')}->{ch.get('new_ticker')}: ERROR {e}"
        print(("[ok] " if ok else "::error::") + msg)
        failed += 0 if ok else 1
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
