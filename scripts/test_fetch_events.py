"""
Offline tests for fetch_events.py (FRED and Supabase are mocked).
Run: python scripts/test_fetch_events.py
"""
import json
import unittest
from collections import Counter
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import fetch_events as fe


class TestRules(unittest.TestCase):
    def test_easter(self):
        # published Easter Sundays
        for y, d in {2019: date(2019, 4, 21), 2024: date(2024, 3, 31), 2025: date(2025, 4, 20),
                     2026: date(2026, 4, 5), 2000: date(2000, 4, 23), 1995: date(1995, 4, 16)}.items():
            self.assertEqual(fe.easter_sunday(y), d, y)

    def test_election_days(self):
        known = {1996: date(1996, 11, 5), 2000: date(2000, 11, 7), 2016: date(2016, 11, 8),
                 2020: date(2020, 11, 3), 2024: date(2024, 11, 5), 2018: date(2018, 11, 6),
                 2022: date(2022, 11, 8), 2026: date(2026, 11, 3), 2028: date(2028, 11, 7)}
        for y, d in known.items():
            self.assertEqual(fe.us_election_day(y), d, y)
            self.assertEqual(fe.us_election_day(y).weekday(), 1)
        pres = fe.rule_dates("us_election_presidential", 1993, 2028)
        mid = fe.rule_dates("us_election_midterm", 1993, 2028)
        self.assertEqual([d.year for d in pres], [1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024, 2028])
        self.assertEqual([d.year for d in mid], [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026])

    def test_monthly_opex(self):
        self.assertEqual(fe.monthly_opex(2026, 9), date(2026, 9, 18))
        self.assertEqual(fe.monthly_opex(2026, 1), date(2026, 1, 16))
        # third Friday = Good Friday -> Thursday
        self.assertEqual(fe.monthly_opex(2019, 4), date(2019, 4, 18))
        self.assertEqual(fe.monthly_opex(2014, 4), date(2014, 4, 17))
        self.assertEqual(fe.monthly_opex(2025, 4), date(2025, 4, 17))
        # Juneteenth on the third Friday: holiday only from 2022
        self.assertEqual(fe.monthly_opex(2026, 6), date(2026, 6, 18))
        self.assertEqual(fe.monthly_opex(2020, 6), date(2020, 6, 19))
        ds = fe.rule_dates("monthly_opex", 1993, 2028)
        self.assertEqual(len(ds), 36 * 12)
        self.assertTrue(all(14 <= d.day <= 21 and d.weekday() in (3, 4) for d in ds))  # Thursday can be the 14th
        self.assertTrue(all(d.weekday() == 4 or d == fe.easter_sunday(d.year) - timedelta(days=3)
                            or d == date(d.year, 6, 18) for d in ds))

    def test_unknown_rule(self):
        with self.assertRaises(ValueError):
            fe.rule_dates("nope", 2020, 2021)


class TestFredCheck(unittest.TestCase):
    def test_monthly_release_passes(self):
        ds = [date(2025, m, 12) for m in range(1, 13)] + [date(2025, 10, 24)]
        self.assertEqual(fe.check_fred_dates(ds, 16), (True, ""))

    def test_daily_vintage_list_refused(self):
        ds = [date(2025, 1, 1) + timedelta(days=i) for i in range(365)]
        ok, reason = fe.check_fred_dates(ds, 16)
        self.assertFalse(ok)
        self.assertIn("365 dates in 2025", reason)

    def test_empty_refused(self):
        self.assertFalse(fe.check_fred_dates([], 16)[0])

    @patch("fetch_events.requests.get")
    def test_fetch_parses_and_dedupes(self, get):
        get.return_value.json.return_value = {"release_dates": [
            {"release_id": 10, "date": "2025-02-12"}, {"release_id": 10, "date": "2025-01-15"},
            {"release_id": 10, "date": "2025-01-15"}]}
        self.assertEqual(fe.fetch_fred_release_dates(10, "k"), [date(2025, 1, 15), date(2025, 2, 12)])
        params = get.call_args.kwargs["params"]
        self.assertEqual(params["include_release_dates_with_no_data"], "true")
        self.assertEqual(params["release_id"], 10)


class TestCuratedFile(unittest.TestCase):
    def test_fomc_file_is_sane(self):
        dates, notes = fe.load_curated("fomc")
        per_year = Counter(d.year for d in dates)
        self.assertEqual(min(per_year), 1994)
        self.assertEqual(max(per_year), 2027)
        bad = {y: n for y, n in per_year.items() if n != 8}
        self.assertEqual(bad, {2020: 7}, "8 scheduled meetings a year; March 2020 was cancelled")
        self.assertTrue(all(d.weekday() < 5 for d in dates), "decision days are weekdays")
        self.assertEqual(len(dates), len(set(dates)))
        for key in notes:
            self.assertIn(date.fromisoformat(key), dates)
        # spot checks against well-known decisions
        for d in ("2008-12-16", "2015-12-16", "2022-03-16", "2024-09-18", "2004-06-30", "2026-09-16"):
            self.assertIn(date.fromisoformat(d), dates, d)

    def test_config_types(self):
        cfg = json.loads(fe.CONFIG_PATH.read_text())
        codes = [t["code"] for t in cfg["types"]]
        self.assertEqual(codes, ["fomc", "cpi", "pce", "us_election_pres", "us_election_mid", "opex_monthly"])
        self.assertTrue(all(set(fe.TYPE_FIELDS) <= set(t) for t in cfg["types"]))
        self.assertEqual({t["code"]: t.get("fred_release_id") for t in cfg["types"] if t["source"] == "fred"},
                         {"cpi": 10, "pce": 54})


# ---------------------------------------------------------------------------
def fake_client(existing):
    """existing: {code: [iso dates]}"""
    c = MagicMock()
    def table(name):
        t = MagicMock()
        t._name = name
        def select(*_a, **_k):
            q = MagicMock()
            def eq(col, val):
                q2 = MagicMock()
                q2.order.return_value.range.return_value.execute.return_value.data = [
                    {"event_date": d} for d in existing.get(val, [])]
                return q2
            q.eq.side_effect = eq
            return q
        t.select.side_effect = select
        c._tables.setdefault(name, []).append(t)
        return t
    c._tables = {}
    c.table.side_effect = table
    return c


def calls(c, name, method):
    return [getattr(t, method) for t in c._tables.get(name, []) if getattr(t, method).called]


CFG = {
    "rule_start_year": 2024, "rule_years_ahead": 1, "fred_max_per_year": 16,
    "types": [
        {"code": "us_election_pres", "name_th": "a", "name_en": "a", "category": "politics", "source": "rule",
         "rule": "us_election_presidential", "nontrading_shift": "next", "show_default": True, "sort_order": 1, "source_note": ""},
        {"code": "cpi", "name_th": "b", "name_en": "b", "category": "inflation", "source": "fred", "fred_release_id": 10,
         "nontrading_shift": "next", "show_default": False, "sort_order": 2, "source_note": ""},
        {"code": "my_manual", "name_th": "c", "name_en": "c", "category": "other", "source": "manual",
         "nontrading_shift": "next", "show_default": True, "sort_order": 3, "source_note": ""},
    ],
}


class TestRun(unittest.TestCase):
    @patch("fetch_events.fetch_fred_release_dates")
    def test_sync_adds_and_removes(self, ff):
        ff.return_value = [date(2025, m, 12) for m in range(1, 13)]
        c = fake_client({"us_election_pres": ["2020-11-03", "2024-11-05"], "cpi": ["2025-01-12", "2025-01-13"]})
        fe.run(False, client=c, today=date(2025, 6, 1), config=CFG, fred_key="k")
        ups = [call.args[0] for m in calls(c, "market_events", "upsert") for call in m.call_args_list]
        written = {(r["event_type"], r["event_date"]) for rows in ups for r in rows}
        self.assertIn(("us_election_pres", "2024-11-05"), written)
        self.assertNotIn(("us_election_pres", "2020-11-03"), written, "outside rule range")
        self.assertEqual(len([w for w in written if w[0] == "cpi"]), 12)
        dels = calls(c, "market_events", "delete")
        self.assertEqual(len(dels), 2, "one stale date removed per type")
        # manual type: never read, never written
        types_upsert = calls(c, "event_types", "upsert")[0].call_args.args[0]
        self.assertEqual([t["code"] for t in types_upsert], ["us_election_pres", "cpi", "my_manual"])
        self.assertFalse(any(r["event_type"] == "my_manual" for rows in ups for r in rows))

    @patch("fetch_events.fetch_fred_release_dates")
    def test_dry_run_writes_nothing(self, ff):
        ff.return_value = [date(2025, m, 12) for m in range(1, 13)]
        c = fake_client({})
        fe.run(True, client=c, today=date(2025, 6, 1), config=CFG, fred_key="k")
        for name in ("market_events", "event_types"):
            for method in ("upsert", "delete", "insert", "update"):
                self.assertEqual(calls(c, name, method), [], f"{name}.{method}")

    @patch("fetch_events.fetch_fred_release_dates")
    def test_refused_fred_list_writes_nothing_for_that_type_and_fails(self, ff):
        ff.return_value = [date(2025, 1, 1) + timedelta(days=i) for i in range(200)]
        c = fake_client({"cpi": ["2025-01-12"], "us_election_pres": ["2020-11-03"]})
        with self.assertRaises(SystemExit):
            fe.run(False, client=c, today=date(2025, 6, 1), config=CFG, fred_key="k")
        ups = [call.args[0] for m in calls(c, "market_events", "upsert") for call in m.call_args_list]
        self.assertFalse(any(r["event_type"] == "cpi" for rows in ups for r in rows))
        self.assertTrue(any(r["event_type"] == "us_election_pres" for rows in ups for r in rows),
                        "other types still sync")
        self.assertEqual(len(calls(c, "market_events", "delete")), 1, "only the election type deletes its stale row; the refused cpi keeps its rows")

    def test_missing_fred_key_fails_that_type_only(self):
        c = fake_client({})
        with self.assertRaises(SystemExit):
            fe.run(False, client=c, today=date(2025, 6, 1), config=CFG, fred_key="")


if __name__ == "__main__":
    unittest.main(verbosity=2)
