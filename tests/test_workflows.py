#!/usr/bin/env python3
"""Tests for the shape of .github/workflows/daily-fetch.yml.

Normally a workflow file is not worth testing. This one is, because round B1
made two of its properties load-bearing in a way that is invisible when you
read a diff:

  * the schedule has to stay far enough from the US close, or the fetch picks
    up a partial universe and nothing errors;
  * the fact-sheet step has to sit after the data steps and before the brief,
    or the brief reads yesterday's sheet and says so in perfectly fluent Thai.

Both are the kind of thing a later edit breaks silently while tidying. Parsed
as text on purpose: PyYAML is not in requirements-dev.txt and one assertion
file is not worth a new dependency.

Run:  pytest tests/test_workflows.py -q
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
DAILY_FETCH = REPO / ".github" / "workflows" / "daily-fetch.yml"


@pytest.fixture(scope="module")
def text() -> str:
    return DAILY_FETCH.read_text(encoding="utf-8")


def step_names(text: str) -> list[str]:
    return re.findall(r"^\s+- name: (.+)$", text, flags=re.M)


def schedules(text: str) -> list[str]:
    return re.findall(r'^\s+- cron: "(.+)"$', text, flags=re.M)


# --------------------------------------------------------------------------
# when it runs
# --------------------------------------------------------------------------


def test_exactly_one_schedule(text):
    assert len(schedules(text)) == 1


def test_fetch_starts_at_least_seven_hours_after_the_us_close(text):
    """The close is 21:00 UTC in winter. Yahoo had only filled 54 of 93 funds
    5 hours after it, and all 93 at 7 hours, so anything earlier than 04:00
    UTC is inside the zone where a partial pull looks like a successful one."""
    minute, hour = schedules(text)[0].split()[:2]
    assert minute.isdigit() and hour.isdigit(), "ตารางเวลาต้องเป็นเวลาเดียว ไม่ใช่ช่วง"
    assert 4 <= int(hour) <= 8, f"ชั่วโมง {hour} UTC อยู่นอกช่วงที่ปลอดภัย"


# --------------------------------------------------------------------------
# what order it runs in
# --------------------------------------------------------------------------


def test_the_fact_sheet_step_exists(text):
    assert "scripts/build_facts.py" in text


def test_fact_sheet_is_built_after_every_source_it_reads(text):
    """Prices are not enough: the sheet also carries a macro group and the
    next 14 days of events."""
    names = step_names(text)
    build = names.index("Build fact sheets")
    for earlier in ("Fetch prices (Yahoo Finance)", "Fetch macro series (FRED)",
                    "Sync market events"):
        assert names.index(earlier) < build, f"{earlier} ต้องมาก่อนการสร้างแผ่น"


def test_brief_runs_after_the_sheet_it_summarises(text):
    names = step_names(text)
    assert names.index("Build fact sheets") < names.index("Daily brief")


# --------------------------------------------------------------------------
# how it fails
# --------------------------------------------------------------------------


def test_the_build_step_is_not_marked_continue_on_error(text):
    """A refused sheet already exits 0 inside the script. If the step were
    also continue-on-error, a genuine database failure would go unnoticed
    too -- and that is the one case here that should turn the job red."""
    block = text[text.index("- name: Build fact sheets"):text.index("- name: Daily brief")]
    assert "continue-on-error" not in block


def test_the_build_step_gets_the_service_role_key(text):
    block = text[text.index("- name: Build fact sheets"):text.index("- name: Daily brief")]
    assert "SUPABASE_SERVICE_ROLE_KEY" in block
    assert "SUPABASE_URL" in block
