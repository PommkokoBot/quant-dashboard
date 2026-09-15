"""
Offline tests for fetch_prices.py / fetch_macro.py logic that does NOT
require live network access (Yahoo/FRED/Supabase are all mocked).

This sandbox's egress is locked to an allowlist that does not include
Yahoo Finance, FRED, or the Supabase REST API directly (only the Supabase
MCP tool, GitHub, and PyPI are reachable here) -- so a true end-to-end
network test could not be run from this environment. These tests instead
pin down the parts that can be verified without a network call: the
sanity-check math, row-building, chunking, and FRED response parsing.
The actual live pull needs to be verified once by running this on
GitHub Actions (which has normal internet access) -- see the note at
the end of this file for the recommended first-run check.

Run: python scripts/test_fetch_offline.py
"""
import os
import sys
import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pandas as pd

import fetch_prices
import fetch_macro


class TestBuildRowsAndFlags(unittest.TestCase):
    def _df(self, rows):
        # rows: list of (date_str, open, high, low, close, adj_close, volume)
        idx = pd.to_datetime([r[0] for r in rows])
        return pd.DataFrame(
            {
                "Open": [r[1] for r in rows],
                "High": [r[2] for r in rows],
                "Low": [r[3] for r in rows],
                "Close": [r[4] for r in rows],
                "Adj Close": [r[5] for r in rows],
                "Volume": [r[6] for r in rows],
            },
            index=idx,
        )

    def test_normal_moves_no_flags(self):
        df = self._df(
            [
                ("2026-01-02", 100, 101, 99, 100.5, 100.5, 1_000_000),
                ("2026-01-03", 100.5, 102, 100, 101.2, 101.2, 1_100_000),
                ("2026-01-04", 101.2, 103, 100.8, 102.0, 102.0, 900_000),
            ]
        )
        rows, flags = fetch_prices.build_rows_and_flags(1, df, prior_close=100.0)
        self.assertEqual(len(rows), 3)
        self.assertEqual(flags, [])
        self.assertEqual(rows[0]["date"], "2026-01-02")
        self.assertAlmostEqual(rows[0]["adj_close"], 100.5)

    def test_large_move_gets_flagged(self):
        # +80% jump on day 2 -- should trip the +-50% sanity threshold
        df = self._df(
            [
                ("2026-01-02", 100, 101, 99, 100.0, 100.0, 1_000_000),
                ("2026-01-03", 100.0, 185, 99, 180.0, 180.0, 5_000_000),
            ]
        )
        rows, flags = fetch_prices.build_rows_and_flags(1, df, prior_close=100.0)
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(flags), 1)
        self.assertEqual(flags[0]["date"], "2026-01-03")
        self.assertAlmostEqual(flags[0]["move_pct"], 80.0)

    def test_boundary_flag_uses_prior_close_from_db(self):
        # first row of the fetch window itself is the one that jumps,
        # relative to what's already stored in the DB (prior_close arg)
        df = self._df([("2026-01-05", 200, 205, 195, 200.0, 200.0, 1_000_000)])
        rows, flags = fetch_prices.build_rows_and_flags(1, df, prior_close=1000.0)  # -80% vs DB
        self.assertEqual(len(flags), 1)
        self.assertAlmostEqual(flags[0]["move_pct"], -80.0)

    def test_no_flag_without_prior_close(self):
        # full-history / very first row ever for an instrument -- nothing to compare against
        df = self._df([("2026-01-05", 200, 205, 195, 200.0, 200.0, 1_000_000)])
        rows, flags = fetch_prices.build_rows_and_flags(1, df, prior_close=None)
        self.assertEqual(len(flags), 0)

    def test_nan_adj_close_row_is_skipped(self):
        df = self._df(
            [
                ("2026-01-02", 100, 101, 99, 100.0, 100.0, 1_000_000),
                ("2026-01-03", None, None, None, None, float("nan"), 0),
            ]
        )
        rows, flags = fetch_prices.build_rows_and_flags(1, df, prior_close=100.0)
        self.assertEqual(len(rows), 1)  # the NaN row was skipped, not written as nulls


class TestFetchYfHistory(unittest.TestCase):
    """Pins down the fix for a real bug hit on the first live GitHub Actions run:
    yfinance's period="max" is rejected outright for some tickers (seen on a Thai
    index symbol -- "Period 'max' is invalid, must be one of: 1d, 5d"). full_history mode must use an
    explicit start date instead of period="max", uniformly for every ticker."""

    @patch("fetch_prices.yf.download")
    def test_full_history_uses_explicit_start_not_period_max(self, mock_download):
        idx = pd.to_datetime(["2020-01-02"])
        mock_download.return_value = pd.DataFrame(
            {"Open": [1], "High": [1], "Low": [1], "Close": [1], "Adj Close": [1.0], "Volume": [100]}, index=idx
        )
        fetch_prices.fetch_yf_history("^EXAMPLE.BK", start=None, full_history=True)
        _, kwargs = mock_download.call_args
        self.assertNotIn("period", kwargs)
        self.assertEqual(kwargs.get("start"), fetch_prices.FULL_HISTORY_START)

    @patch("fetch_prices.yf.download")
    def test_incremental_uses_given_start(self, mock_download):
        idx = pd.to_datetime(["2026-01-02"])
        mock_download.return_value = pd.DataFrame(
            {"Open": [1], "High": [1], "Low": [1], "Close": [1], "Adj Close": [1.0], "Volume": [100]}, index=idx
        )
        fetch_prices.fetch_yf_history("SPY", start="2026-01-01", full_history=False)
        _, kwargs = mock_download.call_args
        self.assertEqual(kwargs.get("start"), "2026-01-01")


class TestUpsertChunking(unittest.TestCase):
    def test_chunks_large_batches(self):
        mock_client = MagicMock()
        rows = [{"instrument_id": 1, "date": f"2020-01-{i:02d}"} for i in range(1, 3)] * 300  # 600 rows
        fetch_prices.upsert_ohlcv(mock_client, rows)
        # 600 rows / CHUNK(500) -> 2 calls to .table().upsert()
        self.assertEqual(mock_client.table.return_value.upsert.call_count, 2)
        for call in mock_client.table.return_value.upsert.call_args_list:
            self.assertEqual(call.kwargs.get("on_conflict"), "instrument_id,date")

    def test_empty_rows_no_call(self):
        mock_client = MagicMock()
        fetch_prices.upsert_ohlcv(mock_client, [])
        mock_client.table.assert_not_called()


class TestRunWiring(unittest.TestCase):
    """Verifies run() calls the right sequence against a fully mocked Supabase
    client + a mocked yfinance download, without any real network access."""

    @patch("fetch_prices.get_client")
    @patch("fetch_prices.fetch_yf_history")
    def test_run_single_ticker_ok_path(self, mock_fetch, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": 1, "ticker": "SPY"}
        ]
        # get_last_close path
        mock_client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []

        idx = pd.to_datetime(["2026-01-02"])
        mock_fetch.return_value = pd.DataFrame(
            {"Open": [1], "High": [1], "Low": [1], "Close": [1], "Adj Close": [1.0], "Volume": [100]}, index=idx
        )

        # run() only calls sys.exit() on the error path (non-zero exit so a
        # GitHub Actions run is easy to spot as failed) -- on the all-ok path
        # it returns normally, so no SystemExit should be raised here.
        fetch_prices.run(lookback_days=10, full_history=False, only_ticker="SPY")
        mock_client.table.return_value.upsert.assert_called()


def _yf(rows):
    """rows: list of (date, close, adj_close)"""
    idx = pd.to_datetime([r[0] for r in rows])
    return pd.DataFrame(
        {"Open": [r[1] for r in rows], "High": [r[1] for r in rows], "Low": [r[1] for r in rows],
         "Close": [r[1] for r in rows], "Adj Close": [r[2] for r in rows], "Volume": [100] * len(rows)},
        index=idx,
    )


class TestDetectBasisChange(unittest.TestCase):
    """2026-09-15: a dividend or split after the last full download re-bases
    Yahoo's whole adjusted history; the incremental run must notice."""

    STORED = {"2026-09-08": (100.0, 98.0), "2026-09-09": (101.0, 98.98), "2026-09-10": (102.0, 99.96)}

    def test_same_basis_returns_none(self):
        df = _yf([("2026-09-09", 101.0, 98.98), ("2026-09-10", 102.0, 99.96), ("2026-09-11", 103.0, 100.94)])
        self.assertIsNone(fetch_prices.detect_basis_change(self.STORED, df))

    def test_float_noise_is_ignored(self):
        df = _yf([("2026-09-09", 101.0 * (1 + 1e-9), 98.98 * (1 - 1e-9))])
        self.assertIsNone(fetch_prices.detect_basis_change(self.STORED, df))

    def test_new_dividend_rescales_adj_close(self):
        # a 0.5% dividend went ex after the stored download: every older adj_close x0.995
        df = _yf([("2026-09-09", 101.0, 98.98 * 0.995), ("2026-09-10", 102.0, 99.96 * 0.995), ("2026-09-11", 102.5, 102.5)])
        res = fetch_prices.detect_basis_change(self.STORED, df)
        self.assertEqual(res["reason"], "adjustment")
        self.assertEqual(res["date"], "2026-09-09")
        self.assertAlmostEqual(res["new_ratio"] / res["stored_ratio"], 0.995, places=9)

    def test_smallest_real_dividend_still_detected(self):
        df = _yf([("2026-09-09", 101.0, 98.98 * (1 - 1e-4))])
        self.assertIsNotNone(fetch_prices.detect_basis_change(self.STORED, df))

    def test_split_rescales_close(self):
        # 2:1 split: Yahoo's split-adjusted close for old days halves
        df = _yf([("2026-09-09", 50.5, 49.49), ("2026-09-10", 51.0, 49.98)])
        res = fetch_prices.detect_basis_change(self.STORED, df)
        self.assertEqual(res["reason"], "close")

    def test_no_overlap_or_unusable_rows(self):
        self.assertIsNone(fetch_prices.detect_basis_change(self.STORED, _yf([("2026-09-11", 1.0, 1.0)])))
        self.assertIsNone(fetch_prices.detect_basis_change({}, _yf([("2026-09-09", 101.0, 50.0)])))
        stored_null = {"2026-09-09": (None, 98.98)}
        self.assertIsNone(fetch_prices.detect_basis_change(stored_null, _yf([("2026-09-09", 101.0, 50.0)])))
        self.assertIsNone(fetch_prices.detect_basis_change(self.STORED, _yf([("2026-09-09", float("nan"), 50.0)])))


def _client_with(instruments, stored_rows=None, last_close=None, health=None, health_error=None):
    c = MagicMock()
    c.table.return_value.select.return_value.eq.return_value.execute.return_value.data = instruments
    c.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = last_close or []
    c.table.return_value.select.return_value.eq.return_value.gte.return_value.order.return_value.range.return_value.execute.return_value.data = stored_rows or []
    if health_error:
        c.rpc.return_value.execute.side_effect = health_error
    else:
        c.rpc.return_value.execute.return_value.data = health or []
    return c


def _logged(client):
    return [call.args[0] for call in client.table.return_value.insert.call_args_list]


class TestRunRebase(unittest.TestCase):
    @patch("fetch_prices.get_client")
    @patch("fetch_prices.fetch_yf_history")
    def test_basis_change_triggers_full_history_refetch(self, mock_fetch, mock_get_client):
        stored = [{"date": "2026-09-09", "close": 101.0, "adj_close": 98.98}]
        client = _client_with([{"id": 7, "ticker": "SPY"}], stored_rows=stored)
        mock_get_client.return_value = client
        window = _yf([("2026-09-09", 101.0, 98.98 * 0.99), ("2026-09-10", 102.0, 102.0)])
        full = _yf([("2026-01-02", 90.0, 88.0), ("2026-09-09", 101.0, 98.98 * 0.99), ("2026-09-10", 102.0, 102.0)])
        mock_fetch.side_effect = [window, full]
        fetch_prices.run(lookback_days=10, full_history=False, only_ticker=None)
        self.assertEqual(mock_fetch.call_count, 2)
        self.assertEqual(mock_fetch.call_args_list[1].args, ("SPY", None, True), "second call pulls full history")
        upserted = client.table.return_value.upsert.call_args_list[0].args[0]
        self.assertEqual(len(upserted), 3, "the full series is written, not just the window")
        logs = _logged(client)
        self.assertEqual(logs[0]["status"], "ok")
        self.assertIn("adjustment basis changed", logs[0]["message"])
        self.assertEqual(logs[0]["detail"]["basis_change"]["reason"], "adjustment")

    @patch("fetch_prices.get_client")
    @patch("fetch_prices.fetch_yf_history")
    def test_same_basis_stays_incremental(self, mock_fetch, mock_get_client):
        stored = [{"date": "2026-09-09", "close": 101.0, "adj_close": 98.98}]
        client = _client_with([{"id": 7, "ticker": "SPY"}], stored_rows=stored)
        mock_get_client.return_value = client
        mock_fetch.return_value = _yf([("2026-09-09", 101.0, 98.98), ("2026-09-10", 102.0, 99.96)])
        fetch_prices.run(lookback_days=10, full_history=False, only_ticker=None)
        self.assertEqual(mock_fetch.call_count, 1)
        self.assertEqual(len(client.table.return_value.upsert.call_args_list[0].args[0]), 2)
        self.assertNotIn("basis", _logged(client)[0]["message"])

    @patch("fetch_prices.get_client")
    @patch("fetch_prices.fetch_yf_history")
    def test_full_history_run_never_compares(self, mock_fetch, mock_get_client):
        client = _client_with([{"id": 7, "ticker": "SPY"}])
        mock_get_client.return_value = client
        mock_fetch.return_value = _yf([("2026-09-09", 101.0, 98.0)])
        fetch_prices.run(lookback_days=10, full_history=True, only_ticker=None)
        self.assertEqual(mock_fetch.call_count, 1)
        client.table.return_value.select.return_value.eq.return_value.gte.assert_not_called()


class TestHealthCheck(unittest.TestCase):
    ISSUES = [
        {"instrument_id": 30, "ticker": "IRBO", "issue": "error_streak",
         "detail": {"days": 3, "first_day": "2026-09-12", "last_day": "2026-09-14", "last_message": "yfinance returned no rows"}},
        {"instrument_id": 30, "ticker": "IRBO", "issue": "stale",
         "detail": {"last_date": "2026-07-17", "latest_date_in_db": "2026-09-14", "trading_days_behind": 40}},
    ]

    def test_format_messages(self):
        self.assertIn("error 3 run-days in a row", fetch_prices.format_health_issue(self.ISSUES[0]))
        self.assertIn("40 trading day(s) behind", fetch_prices.format_health_issue(self.ISSUES[1]))

    @patch("fetch_prices.get_client")
    @patch("fetch_prices.fetch_yf_history")
    def test_issues_fail_the_job(self, mock_fetch, mock_get_client):
        client = _client_with([{"id": 1, "ticker": "SPY"}], health=self.ISSUES)
        mock_get_client.return_value = client
        mock_fetch.return_value = _yf([("2026-09-10", 1.0, 1.0)])
        with self.assertRaises(SystemExit) as cm:
            fetch_prices.run(lookback_days=10, full_history=False, only_ticker=None)
        self.assertEqual(cm.exception.code, 1)
        client.rpc.assert_called_with("data_health_report", {"p_error_days": 3, "p_stale_days": 3})

    @patch("fetch_prices.get_client")
    @patch("fetch_prices.fetch_yf_history")
    def test_single_error_without_streak_does_not_fail(self, mock_fetch, mock_get_client):
        client = _client_with([{"id": 1, "ticker": "SPY"}, {"id": 2, "ticker": "BAD"}], health=[])
        mock_get_client.return_value = client
        mock_fetch.side_effect = [_yf([("2026-09-10", 1.0, 1.0)]), pd.DataFrame()]
        fetch_prices.run(lookback_days=10, full_history=False, only_ticker=None)  # no SystemExit
        self.assertEqual([l["status"] for l in _logged(client)], ["ok", "error"])

    @patch("fetch_prices.get_client")
    @patch("fetch_prices.fetch_yf_history")
    def test_health_check_failure_fails_the_job(self, mock_fetch, mock_get_client):
        client = _client_with([{"id": 1, "ticker": "SPY"}], health_error=RuntimeError("rpc down"))
        mock_get_client.return_value = client
        mock_fetch.return_value = _yf([("2026-09-10", 1.0, 1.0)])
        with self.assertRaises(SystemExit):
            fetch_prices.run(lookback_days=10, full_history=False, only_ticker=None)

    @patch("fetch_prices.get_client")
    @patch("fetch_prices.fetch_yf_history")
    def test_single_ticker_debug_run_skips_health_but_fails_on_error(self, mock_fetch, mock_get_client):
        client = _client_with([{"id": 1, "ticker": "SPY"}], health=self.ISSUES)
        mock_get_client.return_value = client
        mock_fetch.return_value = _yf([("2026-09-10", 1.0, 1.0)])
        fetch_prices.run(lookback_days=10, full_history=False, only_ticker="SPY")  # ok path, no exit
        client.rpc.assert_not_called()
        mock_fetch.return_value = pd.DataFrame()
        with self.assertRaises(SystemExit):
            fetch_prices.run(lookback_days=10, full_history=False, only_ticker="SPY")


class TestFredParsing(unittest.TestCase):
    @patch("fetch_macro.requests.get")
    def test_parses_fred_observations_and_skips_missing(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "observations": [
                    {"date": "2026-01-01", "value": "4.25"},
                    {"date": "2026-01-02", "value": "."},  # FRED's missing-value marker
                    {"date": "2026-01-03", "value": "4.30"},
                ]
            },
        )
        mock_get.return_value.raise_for_status = lambda: None
        rows = fetch_macro.fetch_fred_series("DGS10", "lin", "fake_key", "2026-01-01")
        self.assertEqual(len(rows), 2)  # the "." row was skipped
        self.assertEqual(rows[0], {"series_id": "DGS10", "date": "2026-01-01", "value": 4.25, "source": "FRED"})

    def test_bot_fetch_raises_not_implemented(self):
        with self.assertRaises(NotImplementedError):
            fetch_macro.fetch_bot_series()


class TestMacroFullHistory(unittest.TestCase):
    """Pins down the fix for the macro backfill gap: a --full-history run must send
    FULL_HISTORY_START as observation_start instead of the 10-day lookback window,
    for every configured FRED series."""

    @patch("fetch_macro.get_client")
    @patch("fetch_macro.fetch_fred_series")
    def test_full_history_true_uses_fixed_start_for_every_series(self, mock_fetch, mock_get_client):
        mock_get_client.return_value = MagicMock()
        mock_fetch.return_value = []
        with patch.dict(os.environ, {"FRED_API_KEY": "fake_key"}):
            fetch_macro.run(lookback_days=10, full_history=True)
        self.assertGreater(mock_fetch.call_count, 0)
        for call in mock_fetch.call_args_list:
            series_id, units, api_key, start_date = call.args
            self.assertEqual(start_date, fetch_macro.FULL_HISTORY_START)

    @patch("fetch_macro.get_client")
    @patch("fetch_macro.fetch_fred_series")
    def test_full_history_false_uses_lookback_window(self, mock_fetch, mock_get_client):
        mock_get_client.return_value = MagicMock()
        mock_fetch.return_value = []
        with patch.dict(os.environ, {"FRED_API_KEY": "fake_key"}):
            fetch_macro.run(lookback_days=10, full_history=False)
        expected_start = (date.today() - timedelta(days=10)).isoformat()
        for call in mock_fetch.call_args_list:
            _, _, _, start_date = call.args
            self.assertEqual(start_date, expected_start)
            self.assertNotEqual(start_date, fetch_macro.FULL_HISTORY_START)


if __name__ == "__main__":
    unittest.main(verbosity=2)
