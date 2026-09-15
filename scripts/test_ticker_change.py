"""
Offline tests for ticker_change.py (Yahoo and Supabase are mocked).
Run: python scripts/test_ticker_change.py
"""
import unittest
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd

import ticker_change as tc


def stored_df(dates, closes, adjs):
    return pd.DataFrame({"date": dates, "close": closes, "adj_close": adjs})


def yf_df(dates, closes, adjs):
    idx = pd.to_datetime(dates)
    return pd.DataFrame({"Open": closes, "High": closes, "Low": closes, "Close": closes,
                         "Adj Close": adjs, "Volume": [100] * len(dates)}, index=idx)


DATES = [d.date().isoformat() for d in pd.bdate_range("2026-01-01", periods=40)]
CLOSES = list(100 + np.arange(40) * 0.5)


class TestVerify(unittest.TestCase):
    def test_same_fund_passes_even_if_adj_close_differs(self):
        stored = stored_df(DATES, CLOSES, [c * 0.97 for c in CLOSES])
        _, new = tc.new_frame(1, yf_df(DATES, CLOSES, [c * 0.95 for c in CLOSES]))
        ok, rep = tc.verify_same_fund(stored, new)
        self.assertTrue(ok, rep)
        self.assertEqual(rep["overlap_days"], 40)
        self.assertEqual(rep["median_close_diff"], 0.0)

    def test_different_prices_fail(self):
        stored = stored_df(DATES, CLOSES, CLOSES)
        _, new = tc.new_frame(1, yf_df(DATES, [c * 1.3 for c in CLOSES], CLOSES))
        ok, rep = tc.verify_same_fund(stored, new)
        self.assertFalse(ok)
        self.assertIn("does not match", rep["reason"])

    def test_split_since_stored_download_fails(self):
        stored = stored_df(DATES, CLOSES, CLOSES)
        _, new = tc.new_frame(1, yf_df(DATES, [c / 2 for c in CLOSES], [c / 2 for c in CLOSES]))
        self.assertFalse(tc.verify_same_fund(stored, new)[0])

    def test_too_little_overlap_fails(self):
        stored = stored_df(DATES[:10], CLOSES[:10], CLOSES[:10])
        _, new = tc.new_frame(1, yf_df(DATES, CLOSES, CLOSES))
        ok, rep = tc.verify_same_fund(stored, new)
        self.assertFalse(ok)
        self.assertEqual(rep["overlap_days"], 10)

    def test_a_few_bad_days_tolerated(self):
        closes = list(CLOSES)
        closes[5] *= 1.05  # one bad print out of 40 (2.5% of days)
        stored = stored_df(DATES, CLOSES, CLOSES)
        _, new = tc.new_frame(1, yf_df(DATES, closes, closes))
        self.assertTrue(tc.verify_same_fund(stored, new)[0])


class TestPlanWrite(unittest.TestCase):
    def test_replace_when_new_history_covers_stored(self):
        stored = stored_df(DATES[:30] + ["2026-01-03"], CLOSES[:30] + [1.0], CLOSES[:30] + [1.0])  # a Saturday Yahoo no longer has
        rows, new = tc.new_frame(9, yf_df(DATES, CLOSES, [c * 0.9 for c in CLOSES]))
        mode, out, to_delete, info = tc.plan_write(9, stored, rows, new)
        self.assertEqual(mode, "replace")
        self.assertEqual(len(out), 40, "whole new series written")
        self.assertEqual(to_delete, ["2026-01-03"], "stored days missing from the new series are removed")

    def test_splice_keeps_old_returns_and_joins_without_jump(self):
        old_adj = [c * 0.8 for c in CLOSES]          # old basis
        stored = stored_df(DATES, CLOSES, old_adj)
        new_dates = DATES[20:]
        new_adj = [c * 0.9 for c in CLOSES[20:]]      # new basis, history starts later
        rows, new = tc.new_frame(9, yf_df(new_dates, CLOSES[20:], new_adj))
        mode, out, to_delete, info = tc.plan_write(9, stored, rows, new)
        self.assertEqual(mode, "splice")
        self.assertEqual(info["join_date"], DATES[20])
        self.assertAlmostEqual(info["factor"], 0.9 / 0.8, places=12)
        self.assertEqual(info["old_rows_rescaled"], 20)
        self.assertEqual(to_delete, [])
        series = {r["date"]: r["adj_close"] for r in out}
        self.assertEqual(len(series), 40)
        # old daily returns unchanged
        for a, b in zip(DATES[:19], DATES[1:20]):
            self.assertAlmostEqual(series[b] / series[a], (old_adj[DATES.index(b)] / old_adj[DATES.index(a)]), places=12)
        # the step across the join equals the true (raw) return -- no jump
        self.assertAlmostEqual(series[DATES[20]] / series[DATES[19]], CLOSES[20] / CLOSES[19], places=12)
        spliced_part = [r for r in out if r["date"] < DATES[20]]
        self.assertTrue(all(set(r) == {"instrument_id", "date", "adj_close"} for r in spliced_part),
                        "the old part only rewrites adj_close")

    def test_splice_deletes_stored_days_missing_from_new_after_join(self):
        stored = stored_df(DATES + ["2026-03-01"], CLOSES + [1.0], CLOSES + [1.0])
        rows, new = tc.new_frame(9, yf_df(DATES[20:], CLOSES[20:], CLOSES[20:]))
        _, _, to_delete, _ = tc.plan_write(9, stored, rows, new)
        self.assertEqual(to_delete, ["2026-03-01"])


def fake_client(current_ticker, stored_rows):
    c = MagicMock()
    c.table.return_value.select.return_value.eq.return_value.execute.return_value.data = (
        [{"id": 30, "ticker": current_ticker, "name": "x"}] if current_ticker else [])
    c.table.return_value.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value.data = stored_rows
    return c


CHANGE = {"instrument_id": 30, "old_ticker": "IRBO", "new_ticker": "ARTY", "new_name": "iShares Future AI & Tech ETF"}
STORED_ROWS = [{"date": d, "close": c, "adj_close": c * 0.98} for d, c in zip(DATES, CLOSES)]


class TestProcess(unittest.TestCase):
    @patch("ticker_change.fp.fetch_yf_history")
    def test_apply_path_writes_renames_and_logs(self, mock_fetch):
        mock_fetch.return_value = yf_df(DATES, CLOSES, [c * 0.97 for c in CLOSES])
        c = fake_client("IRBO", STORED_ROWS)
        ok, msg = tc.process(c, CHANGE, dry_run=False)
        self.assertTrue(ok, msg)
        self.assertIn("APPLIED", msg)
        mock_fetch.assert_called_once_with("ARTY", None, True)
        c.table.return_value.update.assert_called_once_with({"ticker": "ARTY", "name": "iShares Future AI & Tech ETF"})
        self.assertTrue(c.table.return_value.upsert.called)
        log = c.table.return_value.insert.call_args.args[0]
        self.assertEqual(log["status"], "ok")
        self.assertIn("IRBO -> ARTY", log["message"])

    @patch("ticker_change.fp.fetch_yf_history")
    def test_dry_run_writes_nothing(self, mock_fetch):
        mock_fetch.return_value = yf_df(DATES, CLOSES, CLOSES)
        c = fake_client("IRBO", STORED_ROWS)
        ok, msg = tc.process(c, CHANGE, dry_run=True)
        self.assertTrue(ok)
        self.assertIn("DRY RUN", msg)
        c.table.return_value.upsert.assert_not_called()
        c.table.return_value.update.assert_not_called()
        c.table.return_value.delete.assert_not_called()
        c.table.return_value.insert.assert_not_called()

    @patch("ticker_change.fp.fetch_yf_history")
    def test_failed_verification_writes_nothing(self, mock_fetch):
        mock_fetch.return_value = yf_df(DATES, [x * 2 for x in CLOSES], CLOSES)
        c = fake_client("IRBO", STORED_ROWS)
        ok, msg = tc.process(c, CHANGE, dry_run=False)
        self.assertFalse(ok)
        self.assertIn("VERIFICATION FAILED", msg)
        c.table.return_value.upsert.assert_not_called()
        c.table.return_value.update.assert_not_called()

    @patch("ticker_change.fp.fetch_yf_history")
    def test_unexpected_current_ticker_refuses(self, mock_fetch):
        c = fake_client("XLK", STORED_ROWS)
        ok, msg = tc.process(c, CHANGE, dry_run=False)
        self.assertFalse(ok)
        self.assertIn("refusing", msg)
        mock_fetch.assert_not_called()

    @patch("ticker_change.fp.fetch_yf_history")
    def test_already_renamed_is_skipped(self, mock_fetch):
        c = fake_client("ARTY", STORED_ROWS)
        ok, msg = tc.process(c, CHANGE, dry_run=False)
        self.assertTrue(ok)
        self.assertIn("skipped", msg)
        mock_fetch.assert_not_called()

    @patch("ticker_change.fp.fetch_yf_history")
    def test_empty_yahoo_response_fails(self, mock_fetch):
        mock_fetch.return_value = pd.DataFrame()
        c = fake_client("IRBO", STORED_ROWS)
        ok, msg = tc.process(c, CHANGE, dry_run=False)
        self.assertFalse(ok)
        c.table.return_value.update.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
