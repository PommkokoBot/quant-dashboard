"""Picks the handful of numbers the daily brief is allowed to talk about.

The fact sheet for one day is ~22 kB across ten groups. Most of it has no place
in a market summary: `health` alone is 40 kB of internal diagnostics, and `risk`
carries ATR for all 93 instruments. Sending the lot would cost tokens, invite
the model to wander, and make the gates check things no reader asked for.

So this module takes the five groups the brief is specified to cover (ข้อ 11.4
Step 1 + Step 2, and ข้อ 11.6's Low/High Beta table and Breadth denominator) and
flattens them into a list of facts, each with an id that IS its address in the
sheet: `pair.qqq_spy.spread`, `breadth.today.pct`, `rank.all_top.1`.

That addressing is the whole point. The model cites ids; a gate looks each id up
in the sheet and compares. Opaque ids (f1, f2) would work for the machine and
tell a human reading the brief's audit trail nothing.

Pure functions only: a sheet goes in, facts come out. No I/O, no clock.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Step 1 of the brief. The six asset-class tickers are the same six the
# dashboard hardcodes (app.js ASSET_CLASS_TICKERS), so the brief and the page
# never disagree about what "asset class" means. QQQ and IWM come along because
# the pair spreads are about them.
ASSET_CLASS = ["SPY", "EFA", "EEM", "IEF", "VNQ", "DBC"]
BROAD_EXTRA = ["QQQ", "IWM"]
RET_TICKERS = ASSET_CLASS + BROAD_EXTRA

# ข้อ 11.4 says two timeframes. The sheet carries 1, 5 and 21 days; the brief
# uses the day's move and the one-month trend. 5 is left out of v1 on purpose:
# an unused number in the prompt is a number the model may decide to mention.
RET_LOOKBACKS = [1, 21]

REQUIRED_GROUPS = ["ret.day", "beta", "rank", "pair", "breadth", "events"]

BUCKET_LABEL = {
    "low_beta": "Low Beta",
    "high_beta": "High Beta",
    "market_beta": "Market Beta",
    "negative_corr": "กลุ่มสวนทางตลาด",
}


@dataclass(frozen=True)
class Fact:
    """One citable number (or one dated event).

    `value` is None for the few facts that are text, such as an event name.
    `ticker` is set when the fact is about a single instrument, which lets the
    ticker gate know which symbols the brief was actually handed.
    """
    id: str
    label: str
    value: float | None = None
    unit: str = ""
    text: str | None = None
    ticker: str | None = None


@dataclass
class Selection:
    facts: list[Fact] = field(default_factory=list)
    universe: set[str] = field(default_factory=set)   # every ticker the sheet knows
    trade_date: str = ""

    def by_id(self) -> dict[str, Fact]:
        return {f.id: f for f in self.facts}


def _num(x: Any) -> float | None:
    return float(x) if isinstance(x, (int, float)) else None


def select_facts(sheet: dict) -> Selection:
    """Flatten the five groups into citable facts."""
    groups = sheet.get("groups", {})
    meta = sheet.get("meta", {})
    out: list[Fact] = []

    # ---- Step 1a: the day's move and the month's trend, per asset class -----
    ret = groups.get("ret.day", {})
    keys = list(ret.get("keys", []))
    values = ret.get("values", {})
    for ticker in RET_TICKERS:
        row = values.get(ticker)
        if not isinstance(row, list):
            continue
        for lb in RET_LOOKBACKS:
            if lb not in keys:
                continue
            v = _num(row[keys.index(lb)])
            if v is None:
                continue
            out.append(Fact(
                id=f"ret.{ticker}.{lb}d",
                label=f"{ticker} ผลตอบแทน {lb} วัน",
                value=v, unit="pct", ticker=ticker,
            ))

    # ---- Step 1b: how each behaviour bucket moved (ข้อ 11.6) ----------------
    beta = groups.get("beta", {})
    for code, b in (beta.get("buckets") or {}).items():
        label = BUCKET_LABEL.get(code, code)
        for suffix, lb in (("avg_1d", "1 วัน"), ("avg_21d", "21 วัน")):
            v = _num(b.get(suffix))
            if v is not None:
                out.append(Fact(
                    id=f"beta.{code}.{suffix}",
                    label=f"{label} ค่าเฉลี่ย {lb}",
                    value=v, unit="pct",
                ))
        n = _num(b.get("n"))
        if n is not None:
            out.append(Fact(id=f"beta.{code}.n", label=f"{label} จำนวนกอง",
                            value=n, unit="count"))

    # ---- Step 2: who led and who lagged ------------------------------------
    rank = groups.get("rank", {})
    for bucket in ("all_top", "all_bottom", "thematic_top", "thematic_bottom"):
        for i, pair in enumerate(rank.get(bucket) or [], start=1):
            if not (isinstance(pair, list) and len(pair) == 2):
                continue
            ticker, v = pair[0], _num(pair[1])
            if v is None:
                continue
            out.append(Fact(
                id=f"rank.{bucket}.{i}",
                label=f"{ticker} ผลตอบแทน 21 วัน (อันดับ {i} ของ {bucket})",
                value=v, unit="pct", ticker=ticker,
            ))
    for pair in rank.get("us_sector_ranked") or []:
        if not (isinstance(pair, list) and len(pair) == 2):
            continue
        ticker, v = pair[0], _num(pair[1])
        if v is None:
            continue
        out.append(Fact(
            id=f"rank.us_sector.{ticker}",
            label=f"{ticker} ผลตอบแทน 21 วัน",
            value=v, unit="pct", ticker=ticker,
        ))

    # ---- The three pair spreads, with their percentiles (ข้อ 11.6) ---------
    for code, p in (groups.get("pair", {}).get("values") or {}).items():
        label = p.get("label", code)
        for suffix, unit, what in (
            ("spread", "pct_points", "ส่วนต่าง 21 วัน"),
            ("pctile_3y", "pctile", "เปอร์เซ็นไทล์ของส่วนต่าง"),
            ("n_days", "count", "จำนวนวันที่ใช้คิดเปอร์เซ็นไทล์"),
        ):
            v = _num(p.get(suffix))
            if v is not None:
                out.append(Fact(id=f"pair.{code}.{suffix}",
                                label=f"{label} {what}", value=v, unit=unit))

    # ---- Breadth, always with its denominator -------------------------------
    breadth = groups.get("breadth", {})
    for when, th in (("today", "วันนี้"), ("prior_21d", "21 วันก่อน")):
        b = breadth.get(when) or {}
        for suffix, unit, what in (("pct", "pct", "% ที่อยู่เหนือ SMA200"),
                                   ("above", "count", "จำนวนกองที่เหนือ SMA200"),
                                   ("universe", "count", "จำนวนกองที่ติดตาม")):
            v = _num(b.get(suffix))
            if v is not None:
                out.append(Fact(id=f"breadth.{when}.{suffix}",
                                label=f"{what} ({th})", value=v, unit=unit))

    # ---- What is on the calendar in the next two weeks ----------------------
    for i, ev in enumerate(groups.get("events", {}).get("items") or [], start=1):
        out.append(Fact(id=f"events.{i}", label="เหตุการณ์ที่กำหนดไว้",
                        text=f"{ev.get('date')} {ev.get('name')}", unit="date"))

    return Selection(
        facts=out,
        universe=_universe(groups),
        trade_date=str(meta.get("trade_date", "")),
    )


def _universe(groups: dict) -> set[str]:
    """Every ticker the sheet covers, taken from the behaviour buckets.

    The buckets partition the active universe, so their union is the list the
    ticker gate measures against -- not a hardcoded list that would drift the
    first time an instrument is added or retired.
    """
    tickers: set[str] = set()
    for b in (groups.get("beta", {}).get("buckets") or {}).values():
        tickers.update(b.get("members") or [])
    return tickers


def missing_groups(sheet: dict) -> list[str]:
    """Gate 0's input: which of the groups the brief needs are absent or empty."""
    groups = sheet.get("groups", {})
    missing = []
    for name in REQUIRED_GROUPS:
        g = groups.get(name)
        if not g or (isinstance(g, dict) and g.get("available") is False):
            missing.append(name)
    return missing
