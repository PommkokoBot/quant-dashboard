#!/usr/bin/env python3
"""Tests for scripts/build_facts.py.

The script is deliberately thin -- the completeness rule lives in SQL -- so
what is worth testing here is the contract with the workflow: what it reports,
and above all that a refused day is NOT treated as a failure.

Run:  pytest tests/test_build_facts.py -q
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
)

import build_facts as bf  # noqa: E402

CREATED = {"trade_date": "2026-11-12", "created": True, "reason": "สร้างใหม่"}
REFUSED = {
    "trade_date": "2026-11-10",
    "created": False,
    "reason": "ข้อมูลไม่ครบ · ไม่ครบ — 54 กอง จากค่าปกติ 93 (58.1%) · ขั้นต่ำ 98.0%"
              " — ยังไม่สร้างแผ่น รอรอบถัดไป",
}
TOO_EARLY = {
    "trade_date": "2026-11-13",
    "created": False,
    "reason": "ยังไม่ถึงเวลา — สร้างได้ตั้งแต่ 2026-11-14 00:00 UTC",
}


class FakeClient:
    """Stands in for the Supabase client: records the call, returns rows."""

    def __init__(self, rows=None, raises: Exception | None = None):
        self.rows = rows if rows is not None else []
        self.raises = raises
        self.calls: list[tuple[str, dict]] = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return self

    def execute(self):
        if self.raises:
            raise self.raises
        return self

    @property
    def data(self):
        return self.rows


# --------------------------------------------------------------------------
# What it asks the database for
# --------------------------------------------------------------------------


def test_calls_the_catch_up_rpc_with_the_window():
    client = FakeClient([CREATED])
    bf.run(client, days=20)
    assert client.calls == [("catch_up_daily_facts", {"p_days": 20})]


def test_default_window_is_ten_trading_days():
    client = FakeClient([])
    bf.run(client)
    assert client.calls[0][1] == {"p_days": bf.DEFAULT_DAYS}
    assert bf.DEFAULT_DAYS == 10


def test_no_rows_is_a_normal_quiet_day():
    assert bf.run(FakeClient([])) == []


def test_a_database_error_is_not_swallowed():
    """A refused day is fine; an unreachable database is not. If this ever
    starts returning [] instead of raising, a broken pipeline would look like
    a quiet morning."""
    with pytest.raises(RuntimeError):
        bf.run(FakeClient(raises=RuntimeError("connection refused")))


# --------------------------------------------------------------------------
# What it reports
# --------------------------------------------------------------------------


def test_summary_of_nothing_to_do():
    assert "ไม่ต้องทำอะไร" in bf.summarize([])


def test_summary_counts_both_sides():
    text = bf.summarize([CREATED, REFUSED, TOO_EARLY])
    assert "แตะทั้งหมด 3 วัน" in text
    assert "สร้างใหม่ 1" in text
    assert "ยังไม่สร้าง 2" in text


def test_summary_keeps_the_reason_for_every_day():
    """The reason is the only place the operator learns WHY a sheet is
    missing. Dropping it would turn a diagnosable morning into a mystery."""
    text = bf.summarize([REFUSED])
    assert "2026-11-10" in text
    assert "54 กอง" in text
    assert "58.1%" in text


def test_created_and_skipped_are_labelled_differently():
    text = bf.summarize([CREATED, REFUSED])
    assert "สร้างแล้ว" in text
    assert "ข้าม" in text
