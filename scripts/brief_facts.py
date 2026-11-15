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

# Fallback only. On a v2 sheet the asset-class list comes from the sheet
# itself (rank.asset_class, which the database builds from universe_tickers),
# so the page, the sheet and the brief all read one list. This constant stays
# for v1 sheets, which were frozen before that table existed.
ASSET_CLASS_FALLBACK = ["SPY", "EFA", "EEM", "IEF", "VNQ", "DBC"]
BROAD_EXTRA = ["QQQ", "IWM"]

# The brief is weekly now, so the day's own move is noise: it is one fifth of
# what the reader is being told about. 5 and 21 days are the two the weekly
# lens actually uses (มติ ข้อ 11).
RET_LOOKBACKS = [5, 21]
# Weekly returns, which is the granularity the brief's own title claims.
# Without these every sentence about "this week" had no fact to cite -- the
# gap that made every volume claim in the 14 พ.ย. draft contradict the sheet.
RETW_LOOKBACKS = [1, 4]

# v1 sheets were frozen before the weekly groups existed. Demanding the new
# groups from them would hold every brief built from an older sheet, so gate 0
# asks for what that sheet's version was supposed to carry -- no more.
REQUIRED_GROUPS_V1 = ["ret.day", "beta", "rank", "pair", "breadth", "events"]
REQUIRED_GROUPS_V2 = REQUIRED_GROUPS_V1 + ["ret.week", "vol.week", "seasonal"]

# รหัสกลุ่มดิบที่เคยหลุดเข้าไปอยู่ในบทสรุปที่คนอ่าน (11 พ.ย.: "อันดับ 1 ของ all_top")
# ต้นตอคือป้ายชื่อ fact ที่เราเขียนเอง ไม่ใช่โมเดลดื้อ จึงแก้ที่ป้าย
RANK_LABEL = {
    "all_top": "สูงสุดของทั้งลิสต์",
    "all_bottom": "ต่ำสุดของทั้งลิสต์",
    "thematic_top": "สูงสุดของกองธีม",
    "thematic_bottom": "ต่ำสุดของกองธีม",
    "asset_class": "ในกลุ่มประเภทสินทรัพย์",
    "broad_market": "ในกลุ่มตลาดกว้าง",
}
UNIVERSE_RANK_KEYS = [("asset_class", "asset_class_ranked", 6),
                      ("broad_market", "broad_market_ranked", 5)]

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
    ret_tickers = _asset_class_tickers(groups) + BROAD_EXTRA
    ret = groups.get("ret.day", {})
    keys = list(ret.get("keys", []))
    values = ret.get("values", {})
    for ticker in ret_tickers:
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
                label=f"{ticker} ผลตอบแทน {lb} วันทำการล่าสุด",
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
                label=f"{ticker} ผลตอบแทน 21 วัน (อันดับ {i} {RANK_LABEL[bucket]})",
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
            label=f"{ticker} ผลตอบแทน 21 วัน (ในกลุ่ม US Sector)",
            value=v, unit="pct", ticker=ticker,
        ))

    # อันดับในสอง universe ที่เดิมมีแต่บนหน้าเว็บ (รอบ B2a)
    # id ลงท้ายด้วยตำแหน่ง เพื่อให้ด่าน 1 ตรวจคำว่า "อันดับ N" ได้เหมือน rank.*_top.*
    for code, key, limit in UNIVERSE_RANK_KEYS:
        for i, pair in enumerate((rank.get(key) or [])[:limit], start=1):
            if not (isinstance(pair, list) and len(pair) == 2):
                continue
            ticker, v = pair[0], _num(pair[1])
            if v is None:
                continue
            out.append(Fact(
                id=f"rank.{code}.{i}",
                label=f"{ticker} ผลตอบแทน 21 วัน (อันดับ {i} {RANK_LABEL[code]})",
                value=v, unit="pct", ticker=ticker,
            ))

    # ---- ผลตอบแทนรายสัปดาห์ (รอบ B2a) --------------------------------------
    retw = groups.get("ret.week", {})
    wkeys = list(retw.get("keys", []))
    wvalues = retw.get("values", {})
    for ticker in ret_tickers:
        row = wvalues.get(ticker)
        if not isinstance(row, list):
            continue
        for lb in RETW_LOOKBACKS:
            if lb not in wkeys:
                continue
            v = _num(row[wkeys.index(lb)])
            if v is None:
                continue
            out.append(Fact(
                id=f"retw.{ticker}.{lb}w",
                label=f"{ticker} ผลตอบแทนย้อนหลัง {lb} สัปดาห์ (นับเป็นสัปดาห์ที่ปิดแล้ว)",
                value=v, unit="pct", ticker=ticker,
            ))

    # ---- ปริมาณซื้อขายรายสัปดาห์ เฉพาะกองที่อยู่หัวแถว ----------------------
    # เฉพาะห้าตัวบนเท่านั้นโดยตั้งใจ: ตัวเลขที่ส่งเข้า prompt แต่ไม่ได้ใช้
    # คือตัวเลขที่โมเดลอาจหยิบมาพูด (เหตุผลเดียวกับที่ v1 ตัด 5 วันออก)
    volw = (groups.get("vol.week", {}).get("values") or {})
    for pair in (rank.get("all_top") or [])[:5]:
        if not (isinstance(pair, list) and len(pair) == 2):
            continue
        ticker = pair[0]
        row = volw.get(ticker)
        if not isinstance(row, list) or len(row) < 2:
            continue
        z, rvol = _num(row[0]), _num(row[1])
        if z is not None:
            out.append(Fact(id=f"volw.{ticker}.z",
                            label=f"{ticker} ปริมาณซื้อขายสัปดาห์นี้ เทียบฐาน 20 สัปดาห์ (z)",
                            value=z, unit="sigma", ticker=ticker))
        if rvol is not None:
            out.append(Fact(id=f"volw.{ticker}.rvol",
                            label=f"{ticker} ปริมาณซื้อขายสัปดาห์นี้ เป็นกี่เท่าของฐาน 20 สัปดาห์",
                            value=rvol, unit="times", ticker=ticker))

    # ---- สถิติฤดูกาล ต้องมาคู่กับฐานเทียบเสมอ (รอบ B2a) --------------------
    out.extend(_seasonal_facts(groups.get("seasonal", {})))

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
    # ป้ายเดิมเขียนว่า "วันนี้" ซึ่งเป็นคำที่ด่าน 3 ห้ามในคำตอบ · prompt จึง
    # ชวนให้โมเดลเขียนคำที่จะถูกจับทันที และบทสรุปรายสัปดาห์ยิ่งไม่ใช่ "วันนี้"
    for when, th in (("today", "ณ วันที่ของข้อมูล"), ("prior_21d", "21 วันก่อน")):
        b = breadth.get(when) or {}
        for suffix, unit, what in (("pct", "pct_level", "% ที่อยู่เหนือ SMA200"),
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


def _asset_class_tickers(groups: dict) -> list[str]:
    """รายชื่อ asset class · เอาจากแผ่นก่อน ค่อยตกมาที่ค่าคงที่

    แผ่น v2 พกอันดับของ asset class มาด้วย ซึ่งฐานข้อมูลสร้างจาก
    universe_tickers() ตัวเดียวกับที่หน้าเว็บจะอ่านในอนาคต · การอ่านจากแผ่น
    จึงลบรายชื่อชุดที่สามของโปรเจกต์นี้ทิ้งไปหนึ่งชุด
    """
    ranked = (groups.get("rank", {}) or {}).get("asset_class_ranked")
    if isinstance(ranked, list) and ranked:
        tickers = [p[0] for p in ranked
                   if isinstance(p, list) and len(p) == 2 and isinstance(p[0], str)]
        if tickers:
            return tickers
    return list(ASSET_CLASS_FALLBACK)


def _seasonal_facts(seasonal: dict) -> list[Fact]:
    """สถิติฤดูกาล และฐานเทียบของมัน

    ฐานเทียบไม่ใช่ของแถม: "สัปดาห์ที่ 46 ชนะ 60%" ไม่มีความหมายจนกว่าจะรู้ว่า
    ทุกสัปดาห์ชนะ 58.9% · ด่าน 5 บังคับให้ประโยคที่อ้าง seasonal.* ต้องอ้าง
    seasonal_baseline ของงวดเดียวกันมาด้วยเสมอ จึงต้องส่งทั้งคู่เข้า prompt
    """
    out: list[Fact] = []
    if not isinstance(seasonal, dict):
        return out

    windows = (("week_current", "สัปดาห์ปัจจุบัน"),
               ("week_next", "สัปดาห์ถัดไป"),
               ("month_next", "เดือนที่กำลังจะถึง"))
    for key, th in windows:
        w = seasonal.get(key) or {}
        if not w.get("available"):
            continue
        period = w.get("period")
        head = f"SPY {th} ({period})"
        for suffix, unit, what in (
            ("win_pct", "pct_level", "สัดส่วนครั้งที่ปิดบวกในอดีต"),
            ("mean_pct", "pct", "ผลตอบแทนเฉลี่ยในอดีต"),
            ("n", "count", "จำนวนครั้งที่ใช้คิด"),
        ):
            v = _num(w.get(suffix))
            if v is not None:
                out.append(Fact(id=f"seasonal.{key}.{suffix}",
                                label=f"{head} {what}", value=v, unit=unit))

    for key, th, period_type in (("baseline_week", "ทุกสัปดาห์", "week"),
                                 ("baseline_month", "ทุกเดือน", "month")):
        b = seasonal.get(key) or {}
        if b.get("available") is False or b.get("n") is None:
            continue
        for suffix, unit, what in (
            ("win_pct", "pct_level", "ค่าปกติ สัดส่วนครั้งที่ปิดบวก"),
            ("mean_pct", "pct", "ค่าปกติ ผลตอบแทนเฉลี่ย"),
            ("n", "count", "ค่าปกติ จำนวนงวดที่ใช้คิด"),
        ):
            v = _num(b.get(suffix))
            if v is not None:
                out.append(Fact(id=f"seasonal_baseline.{period_type}.{suffix}",
                                label=f"SPY {th} {what}", value=v, unit=unit))
    return out


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


def required_groups(sheet: dict) -> list[str]:
    """What this sheet's own version was supposed to carry."""
    version = str((sheet.get("meta") or {}).get("facts_version", "v1"))
    return REQUIRED_GROUPS_V2 if version >= "v2" else REQUIRED_GROUPS_V1


def missing_groups(sheet: dict) -> list[str]:
    """Gate 0's input: which of the groups the brief needs are absent or empty."""
    groups = sheet.get("groups", {})
    missing = []
    for name in required_groups(sheet):
        g = groups.get(name)
        if not g or (isinstance(g, dict) and g.get("available") is False):
            missing.append(name)
    return missing
