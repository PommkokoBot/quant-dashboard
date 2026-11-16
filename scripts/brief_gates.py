"""The gates a generated brief must pass before anything is published.

Every gate here is a pure function: a parsed model response and the day's facts
go in, a list of findings comes out. No network, no database, no clock. That is
deliberate and it is the one place this design differs from the usual pattern of
asking a second model to review the first -- a reviewer that can be wrong in the
same way as the thing it reviews is not a check, it is a second opinion.

The gates, in the order they run:

  0  the sheet carries every group the brief needs, for the day we asked for
  1  every number in a sentence matches a fact that sentence cites, in value
     AND in direction
  2  every ticker mentioned is one of the instruments the sheet covers
  3  no recommendation language, and no words that assume what day it is read
  4  every evaluative adjective is backed by a number the sentence cites
  5  every seasonal claim carries the baseline that makes it mean anything

Failing any of them means the brief is not published (มติ ข้อ 3 ของรอบ B). The
findings are what gets written to validation_log and sent to Telegram, so each
one names the sentence and says what was wrong in words a person can act on.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from brief_facts import Selection

# ---------------------------------------------------------------------------
# Vocabulary. Kept at the top so changing policy never means reading the code.
# ---------------------------------------------------------------------------

# ข้อห้ามข้อแรกของโปรเจกต์: บอกสิ่งที่ข้อมูลแสดง ไม่ใช่สิ่งที่ควรทำ
FORBIDDEN_TH = [
    "ควรซื้อ", "ควรขาย", "ควรถือ", "น่าซื้อ", "น่าขาย", "น่าสะสม", "น่าลงทุน",
    "ทยอยสะสม", "ราคาเป้าหมาย", "เป้าหมายราคา", "แนะนำ", "ถูกเกินไป", "แพงเกินไป",

    # การไหลของเงิน: เรามีแต่ราคาและปริมาณหุ้นที่ซื้อขาย ไม่มีข้อมูลว่าเงิน
    # ไหลไปไหน ประโยคแบบ "เงินไหลเข้ากลุ่มปลอดภัย" จึงเป็นการแต่งเรื่อง
    # ที่ไม่มี fact ใดในแผ่นพิสูจน์ได้เลย (หลุดใน draft 14 พ.ย.)
    "ไหลเข้า", "ไหลออก", "เงินทุนไหล", "เม็ดเงิน", "กระแสเงิน", "พักเงิน",
    "หลบเข้า", "เข้าหลุมหลบภัย", "สินทรัพย์ปลอดภัย",

    # ป้ายชื่อกลุ่มที่เราไม่ได้คำนวณ: เราจัดกลุ่มด้วย beta กับสหสัมพันธ์
    # ไม่ได้จัดด้วยลักษณะธุรกิจ จะเรียก Defensive หรือ Cyclical ไม่ได้
    "ตั้งรับ", "เชิงรับ", "เชิงรุก", "วัฏจักร", "กลุ่มปลอดภัย",

    # ผู้เล่นที่เรามองไม่เห็น: แผ่นข้อมูลไม่รู้ว่าใครซื้อใครขาย
    "นักลงทุนสถาบัน", "รายย่อย", "ต่างชาติ", "กองทุนใหญ่", "ขาใหญ่",

    # คำขยายที่ฟังเหมือนมีหลักฐานแต่ไม่ผูกกับเกณฑ์ใด ใช้ตัวเลขพูดแทน
    "อย่างมีนัยสำคัญ", "อย่างมาก", "ชัดเจน",
]
FORBIDDEN_EN = [
    "buy", "sell", "accumulate", "undervalued", "overvalued",
    "overweight", "underweight", "recommend", "target price",
]

# บทสรุปถูกอ่านคนละวันกับวันที่ของข้อมูล และคิวของ GitHub ทำให้เวลาเผยแพร่
# ไม่แน่นอน คำเหล่านี้จึงกลายเป็นคำโกหกได้เองโดยไม่มีใครแก้อะไรเลย
# "สัปดาห์นี้" ไม่อยู่ในรายการนี้โดยตั้งใจ: มติ 17 บังคับให้บรีฟออกในสัปดาห์
# ISO เดียวกับวันข้อมูล คำนั้นจึงเป็นจริงตอนเผยแพร่ · แต่ "สัปดาห์ปัจจุบัน"
# ผิดแม้ตอนเผยแพร่ เพราะสัปดาห์นั้นปิดไปแล้วตอนตลาดปิดวันศุกร์
VAGUE_TIME_TH = ["วันนี้", "เมื่อวาน", "พรุ่งนี้", "ตอนนี้", "ขณะนี้", "เมื่อเช้า",
                 "สัปดาห์ปัจจุบัน"]

# ข้อ 11.5: คำประเมินทุกคำต้องผูกกับเกณฑ์ตัวเลขที่ตรวจด้วยเครื่องได้
EXTREME_WORDS = ["ผิดปกติ", "สูงผิดปกติ", "ต่ำผิดปกติ"]          # ต้องมี pctile >=95 หรือ <=5
SUPERLATIVE_WORDS = ["กว้างสุด", "แคบสุด", "สูงสุดในรอบ", "ต่ำสุดในรอบ"]  # ต้อง >=99 หรือ <=1
LEADER_WORDS = ["มาแรง"]                                          # ต้องอ้างอันดับต้น

# ขาดลอย = ส่วนต่างอยู่ปลายแถบ แต่ไม่ต้องถึงขั้น "ผิดปกติ"
WIDE_WORDS = ["ขาดลอย", "ทิ้งห่าง", "นำห่าง"]
# คำเรื่องปริมาณซื้อขาย ใช้ได้เพราะรอบ B2a เริ่มส่ง vol.week เข้า prompt
# (ก่อนหน้านี้ "มาเร็ว" อยู่ในรายการคำห้าม เพราะไม่มี fact ใดพิสูจน์ได้)
VOLUME_WORDS = ["มาเร็ว", "เร่งขึ้น", "คึกคัก", "ปริมาณหนาแน่น"]
# คำที่บอกว่าความกว้างของตลาดกำลังแย่ลง ต้องมีทั้งระดับและทิศทาง
FRAGILE_WORDS = ["เปราะบาง", "อ่อนแอลง", "ไม่ทั่วถึง"]
# คำที่บอกว่าของสองอย่างไปคนละทาง ต้องมีตัวเลขสองตัวที่เครื่องหมายต่างกันจริง
DIVERGE_WORDS = ["สวนทาง", "ขัดแย้งกัน", "ไปคนละทาง"]
# รอบ B2b-1: สองคำที่จองไว้ตั้งแต่ข้อ 11.5 แต่ไม่เคยมี fact รองรับ จนกลุ่ม risk
# ถูกส่งเข้า prompt · ก่อนรอบนี้ไม่มีด่านใดจับสองคำนี้เลย โมเดลจึงใช้ได้ฟรี
# แข็งแกร่ง = ราคาอยู่ช่วงบนของกรอบ 1 ปี · ขยายตัวชัด = ATR อยู่ปลายบนของกรอบ 1 ปี
STRONG_WORDS = ["แข็งแกร่ง"]
EXPAND_WORDS = ["ขยายตัวชัด"]

EXTREME_PCTILE = 95.0
SUPERLATIVE_PCTILE = 99.0
WIDE_PCTILE = 90.0
VOL_Z_MIN = 1.0          # ปริมาณซื้อขายสูงกว่าฐาน 1 ส่วนเบี่ยงเบน
VOL_RVOL_MIN = 1.5       # หรือ 1.5 เท่าของฐาน 20 สัปดาห์
BREADTH_WEAK_PCT = 50.0  # เกณฑ์ "ไม่ทั่วถึง": ต่ำกว่าครึ่ง และต่ำกว่า 21 วันก่อน
STRONG_POS_MIN = 80.0    # ตำแหน่งราคาในกรอบ 1 ปี (risk.*.pos_52w)
EXPAND_ATR_PCTILE = 90.0  # เปอร์เซ็นไทล์ของ ATR ในกรอบ 1 ปี (risk.*.atr_pctile_1y)

# รหัส fact และรหัสกลุ่มดิบ: เป็นชื่อภายในของเรา ไม่ใช่ภาษาที่คนอ่านรู้จัก
# 11 พ.ย. โมเดลเขียน "อันดับ 1 ของ all_top" ลงในบทสรุปที่ส่งถึงคนจริง
RAW_CODES = [
    "all_top", "all_bottom", "thematic_top", "thematic_bottom", "us_sector",
    "asset_class", "broad_market", "week_current", "week_next", "month_next",
    "low_beta", "high_beta", "market_beta", "negative_corr",
    "seasonal_baseline", "baseline_week", "baseline_month",
    "ret.day", "ret.week", "vol.week", "facts_version",
    "atr_pct", "pos_52w", "pct_from_high",   # atr_pct ครอบ atr_pctile_1y ด้วย
]
# ความยาวสูงสุดของทั้งบทสรุป: ยาวกว่านี้คือเขียนเกินตัวเลขที่มี
BODY_MAX_CHARS = 5000

# คำที่บอกทิศทางลง ใช้ตรวจว่าประโยคที่เขียนค่าสัมบูรณ์ของตัวเลขติดลบ
# ได้บอกทิศทางไว้จริง -- ตัวเลขถูกแต่ทิศผิดคือความผิดพลาดที่อันตรายที่สุด
NEGATIVE_WORDS = [
    "ติดลบ", "ลดลง", "ตามหลัง", "ต่ำกว่า", "แย่กว่า", "ร่วง", "ขาดทุน",
    "น้อยกว่า", "ถดถอย", "ลบ", "−", "-",
]

# ตัวพิมพ์ใหญ่ที่ไม่ใช่ ticker
# ISO เพิ่ม 16 พ.ย. 2026 หลังรอบ no-write ของจริงกักบทสรุปสองประโยค: ป้ายชื่อ
# fact ของเราเองเขียนว่า "หมายเลขสัปดาห์ ISO" โมเดลลอกคำนั้นไปเขียนในประโยค
# แล้วด่าน 2 อ่านว่าเป็นกองทุนที่ไม่มีในลิสต์ · เทสต์ test_no_fact_label_looks_
# like_an_unknown_ticker ไล่ทุกป้ายด้วยตัวจับเดียวกัน จะได้ไม่ต้องรอโมเดลพลาด
NON_TICKERS = {
    "CPI", "PCE", "GDP", "ETF", "AI", "US", "FOMC", "SMA", "ATR", "RVOL",
    "OPEX", "NFCI", "PDPA", "QQQ_SPY", "EPS", "PMI", "ISM", "PPI", "ISO",
}

# หน่วยเวลาที่ตามหลังตัวเลข: "21 วัน" คือคำบรรยายช่วง ไม่ใช่ค่าที่วัดได้
TIME_UNITS = ["วัน", "สัปดาห์", "เดือน", "ไตรมาส", "ปี"]
# ตัวเลขบรรยายที่ยอมให้ผ่านโดยไม่ต้องมี fact รองรับ ถ้าตามด้วยหน่วยเวลา
STRUCTURAL_MAX = 31

NUMBER_RE = re.compile(r"-?\d+(?:,\d{3})*(?:\.\d+)?")

# "อันดับ 1" names a position in a ranking, not a measurement. Left to gate 1's
# ordinary handling it is compared against the cited fact's value and always
# fails, which is what happened to the first brief a model ever produced here
# (11 พ.ย.). It is not simply skipped: the rank is in the fact's own id
# (rank.all_top.1), so the claim is checked against that instead -- a number
# the gate could not read before is now a number it verifies.
RANK_WORDS = ["อันดับ", "ลำดับ"]
RANK_RE = re.compile(r"(?:" + "|".join(RANK_WORDS) + r")\s*(?:ที่\s*)?(\d+)")
RANK_ID_RE = re.compile(r"\.(\d+)$")
TICKER_RE = re.compile(r"\b[A-Z]{2,6}\b")
ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
THAI_DATE_RE = re.compile(r"\d{1,2}\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|"
                          r"ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)")


@dataclass(frozen=True)
class Finding:
    gate: int
    code: str
    where: str      # which sentence, in words
    detail: str

    def line(self) -> str:
        return f"[ด่าน {self.gate}] {self.where}: {self.detail}"


# ---------------------------------------------------------------------------
# Gate 0 -- before a single token is sent to the model
# ---------------------------------------------------------------------------

def gate0_sheet(sheet: dict, want_trade_date: str, missing: list[str]) -> list[Finding]:
    """Refuse to generate at all when the inputs are not what we asked for.

    Catching this here rather than in the output is the point: a model handed an
    incomplete sheet does not fail, it writes around the hole. And a request we
    never send costs no quota.
    """
    out: list[Finding] = []
    if missing:
        out.append(Finding(0, "missing_groups", "แผ่นข้อมูล",
                           "ขาดกลุ่ม " + ", ".join(missing)))
    got = str((sheet.get("meta") or {}).get("trade_date", ""))
    if got != want_trade_date:
        out.append(Finding(0, "wrong_date", "แผ่นข้อมูล",
                           f"ขอวันที่ {want_trade_date} แต่แผ่นเป็นของ {got or '(ไม่มี)'}"))
    return out


# ---------------------------------------------------------------------------
# helpers shared by the output gates
# ---------------------------------------------------------------------------

def _strip_dates(text: str) -> str:
    """Dates carry digits that are not measurements."""
    return THAI_DATE_RE.sub(" ", ISO_DATE_RE.sub(" ", text))


def _numbers(text: str) -> list[tuple[float, str]]:
    """Every number worth checking, with the text that follows it.

    A small integer followed by a unit of time ("ในรอบ 21 วัน") describes a
    window rather than reporting a measurement, so it is left out. Anything
    else -- percentages, counts, spreads, percentiles -- has to come from a
    fact. 873 วัน is NOT skipped: it is above STRUCTURAL_MAX, so a wrong
    sample size still fails.
    """
    out = []
    cleaned = _strip_dates(text)
    rank_spans = [m.span(1) for m in RANK_RE.finditer(cleaned)]
    for m in NUMBER_RE.finditer(cleaned):
        # positions are checked by _rank_claims against the fact id instead
        if any(a <= m.start() < b for a, b in rank_spans):
            continue
        # Digits glued to the end of a word are part of the word, not a
        # measurement: SMA200, ATR14, S&P500. Without this the gate rejects
        # every sentence that names an indicator.
        if m.start() > 0 and cleaned[m.start() - 1].isascii() and cleaned[m.start() - 1].isalpha():
            continue
        raw = m.group().replace(",", "")
        try:
            val = float(raw)
        except ValueError:
            continue
        tail = cleaned[m.end():m.end() + 12].lstrip()
        if (abs(val) <= STRUCTURAL_MAX and float(val).is_integer()
                and any(tail.startswith(u) for u in TIME_UNITS)):
            continue
        out.append((val, tail))
    return out


def _rank_claims(text: str) -> list[int]:
    """Every position the sentence claims, as in 'อันดับ 1'."""
    return [int(m.group(1)) for m in RANK_RE.finditer(_strip_dates(text))]


def _ranks_offered(cited_ids) -> set[int]:
    """The positions the cited facts actually stand for.

    rank.all_top.1 is position 1. A fact id with no trailing number offers no
    position at all, so a sentence citing only those cannot claim one.
    """
    out = set()
    for fid in cited_ids:
        m = RANK_ID_RE.search(str(fid))
        if m and str(fid).startswith("rank."):
            out.add(int(m.group(1)))
    return out


def _implied_periods(cited_ids, index) -> list:
    """หมายเลขงวดของหน้าต่างฤดูกาลที่ประโยคอ้างอยู่แล้ว

    ประโยคที่อ้าง seasonal.week_current.win_pct ได้ผูกตัวเองกับหน้าต่าง
    week_current ไปแล้ว และหน้าต่างนั้นมีหมายเลขงวดค่าเดียวจากแผ่น (46) ·
    เลข 46 จึงถูกบ่งชี้ด้วยการอ้างนั้น ไม่ต่างจากที่ rank.all_top.1 บ่งชี้
    ว่าอันดับคือ 1 (ดู _ranks_offered ซึ่งเป็นกลไกเดียวกัน: ตัวระบุมาจาก
    "ประโยคอ้าง fact ตัวไหน" ไม่ใช่จาก "ประโยคเขียนเลขอะไร")

    ทำไมไม่ใช่การผ่อนด่าน: ค่าที่เพิ่มเข้ามาคือ period ของหน้าต่างที่ถูก
    อ้างเท่านั้น ไม่ใช่ค่าอื่นของหน้าต่างนั้น และไม่ใช่ period ของหน้าต่าง
    อื่น · เขียนเลขสัปดาห์ผิด (45) ยังถูกกัก · อ้างแต่สัปดาห์ที่ปิดแล้ว
    แล้วเขียนเลขของสัปดาห์ถัดไป (47) ก็ยังถูกกัก

    ที่มา: 15 พ.ย. 2026 รอบ no-write ที่สาม · B2a.2 ส่ง period เป็น fact
    แล้วแต่โมเดลอ้างเฉพาะ win_pct/mean_pct/n กับฐานเทียบ ด่าน 1 จึงยังกัก
    เลข 46 · การส่ง fact ให้พร้อมใช้ ไม่เท่ากับการที่โมเดลจะอ้างมัน
    """
    out = []
    seen = set()
    for fid in cited_ids:
        parts = str(fid).split(".")
        if len(parts) != 3 or parts[0] != "seasonal":
            continue
        sibling = f"seasonal.{parts[1]}.period"
        if sibling in seen:
            continue
        f = index.get(sibling)
        if f is not None and f.value is not None:
            seen.add(sibling)
            out.append(f)
    return out


def _matches(n: float, v: float) -> bool:
    """True when n is v written to the precision n uses.

    "0.9" matches 0.9164 and "6.25" matches 6.2491, because that is what
    rounding is. "6.5" matches neither.
    """
    s = f"{n:.10f}".rstrip("0")
    decimals = len(s.split(".")[1]) if "." in s else 0
    return abs(round(v, decimals) - n) < 1e-9


def _sentences(response: dict):
    for si, section in enumerate(response.get("sections") or [], start=1):
        heading = str(section.get("heading", f"ส่วนที่ {si}"))
        for qi, sentence in enumerate(section.get("sentences") or [], start=1):
            yield f"{heading} ประโยคที่ {qi}", sentence


# ---------------------------------------------------------------------------
# Gate 1 -- numbers, and the direction they point
# ---------------------------------------------------------------------------

def gate1_numbers(response: dict, sel: Selection) -> list[Finding]:
    out: list[Finding] = []
    index = sel.by_id()

    for where, sentence in _sentences(response):
        text = str(sentence.get("text", ""))
        cited_ids = list(sentence.get("facts") or [])

        unknown = [fid for fid in cited_ids if fid not in index]
        for fid in unknown:
            out.append(Finding(1, "unknown_fact", where,
                               f"อ้าง fact id ที่ไม่มีในแผ่น: {fid}"))

        cited = [index[fid] for fid in cited_ids if fid in index]
        numeric = [f for f in cited if f.value is not None]
        # หมายเลขงวดที่หน้าต่างซึ่งประโยคอ้างบ่งชี้ไว้แล้ว (ดู _implied_periods)
        numeric += _implied_periods(cited_ids, index)

        offered = _ranks_offered(cited_ids)
        for pos in _rank_claims(text):
            if pos not in offered:
                out.append(Finding(
                    1, "unbacked_rank", where,
                    f"ประโยคอ้างอันดับที่ {pos} แต่ fact ที่อ้างไม่ได้เป็นอันดับนั้น "
                    f"({', '.join(str(f) for f in cited_ids) or 'ไม่ได้อ้างอะไรเลย'})"))

        for n, _tail in _numbers(text):
            hits = [f for f in numeric if _matches(abs(n) if n >= 0 else n, f.value)
                    or _matches(n, f.value)]
            if not hits:
                mag = [f for f in numeric if _matches(n, abs(f.value))]
                if not mag:
                    out.append(Finding(
                        1, "unbacked_number", where,
                        f"ตัวเลข {n:g} ไม่ตรงกับ fact ที่ประโยคนี้อ้าง "
                        f"({', '.join(fid for fid in cited_ids) or 'ไม่ได้อ้างอะไรเลย'})"))
                    continue
                hits = mag

            # the number was written as a magnitude of something negative
            if n > 0 and all(f.value < 0 for f in hits):
                if not any(w in text for w in NEGATIVE_WORDS):
                    out.append(Finding(
                        1, "wrong_direction", where,
                        f"ค่าจริงของ {hits[0].id} ติดลบ ({hits[0].value:g}) "
                        f"แต่ประโยคเขียน {n:g} โดยไม่มีคำบอกทิศทางลง"))
    return out


# ---------------------------------------------------------------------------
# Gate 2 -- tickers
# ---------------------------------------------------------------------------

def gate2_tickers(response: dict, sel: Selection) -> list[Finding]:
    out: list[Finding] = []
    for where, sentence in _sentences(response):
        text = str(sentence.get("text", ""))
        for token in TICKER_RE.findall(text):
            if token in NON_TICKERS or token in sel.universe:
                continue
            out.append(Finding(2, "unknown_ticker", where,
                               f"เอ่ยถึง {token} ซึ่งไม่อยู่ใน {len(sel.universe)} กองของวันนั้น"))
    return out


# ---------------------------------------------------------------------------
# Gate 3 -- language that is not ours to use
# ---------------------------------------------------------------------------

def gate3_language(response: dict) -> list[Finding]:
    out: list[Finding] = []
    for where, sentence in _sentences(response):
        text = str(sentence.get("text", ""))
        low = text.lower()
        for w in FORBIDDEN_TH:
            if w in text:
                out.append(Finding(3, "advice", where, f'ใช้คำว่า "{w}" ซึ่งเข้าข่ายคำแนะนำ'))
        for w in FORBIDDEN_EN:
            if re.search(r"\b" + re.escape(w) + r"\b", low):
                out.append(Finding(3, "advice", where, f'ใช้คำว่า "{w}" ซึ่งเข้าข่ายคำแนะนำ'))
        for w in VAGUE_TIME_TH:
            if w in text:
                out.append(Finding(3, "vague_time", where,
                                   f'ใช้คำว่า "{w}" ต้องระบุวันที่จริงแทน'))
        for code in RAW_CODES:
            if code in text:
                out.append(Finding(3, "raw_code", where,
                                   f'เขียนรหัสภายใน "{code}" ลงในประโยค '
                                   "ต้องใช้คำไทยที่คนอ่านเข้าใจ"))
    body = to_text(response)
    if len(body) > BODY_MAX_CHARS:
        out.append(Finding(3, "too_long", "ทั้งบทสรุป",
                           f"ยาว {len(body):,} ตัวอักษร เกินเพดาน "
                           f"{BODY_MAX_CHARS:,} ตัวอักษร"))
    return out


# ---------------------------------------------------------------------------
# Gate 4 -- adjectives have to be earned
# ---------------------------------------------------------------------------

def _section_pools(response: dict, index: dict) -> list[list]:
    """fact ที่ถูกอ้างในแต่ละหัวข้อ รวมทุกประโยคของหัวข้อนั้น

    มีไว้สำหรับคำขยายที่ต้องใช้สองค่าเทียบกัน (ดู FRAGILE_WORDS) · ร้อยแก้ว
    ธรรมชาติมักแยกการเปรียบเทียบเป็นสองประโยค ("ลดลงมาอยู่ที่ A · เทียบกับ
    21 วันก่อนที่ B") · 15 พ.ย. 2026 บรีฟเดียวกัน ข้อมูลเดียวกัน ผ่านเมื่อ
    โมเดลเขียนรวมประโยค ถูกกักเมื่อโมเดลแยกประโยค — ด่านที่คำตัดสินขึ้นกับ
    ตำแหน่งจุดฟูลสต็อปกำลังวัดสไตล์ ไม่ใช่ความจริง
    """
    pools = []
    for section in response.get("sections") or []:
        ids = set()
        for s in section.get("sentences") or []:
            ids.update(str(f) for f in (s.get("facts") or []) if str(f) in index)
        pools.append([index[f] for f in ids])
    return pools


def _sentences_by_section(response: dict):
    for si, section in enumerate(response.get("sections") or [], start=1):
        heading = str(section.get("heading", f"ส่วนที่ {si}"))
        for qi, sentence in enumerate(section.get("sentences") or [], start=1):
            yield si - 1, f"{heading} ประโยคที่ {qi}", sentence


def _value_in(facts, fid: str):
    return next((f.value for f in facts if f.id == fid), None)


def gate4_adjectives(response: dict, sel: Selection) -> list[Finding]:
    out: list[Finding] = []
    index = sel.by_id()
    pools = _section_pools(response, index)

    for si, where, sentence in _sentences_by_section(response):
        text = str(sentence.get("text", ""))
        cited = [index[f] for f in (sentence.get("facts") or []) if f in index]
        pool_facts = pools[si] if si < len(pools) else []
        pctiles = [f.value for f in cited if f.unit == "pctile" and f.value is not None]
        has_rank_top = any(f.id.startswith("rank.") and "_top" in f.id for f in cited)

        for w in EXTREME_WORDS:
            if w in text and not any(p >= EXTREME_PCTILE or p <= 100 - EXTREME_PCTILE
                                     for p in pctiles):
                out.append(Finding(
                    4, "unbacked_adjective", where,
                    f'ใช้คำว่า "{w}" แต่ไม่ได้อ้างเปอร์เซ็นไทล์ที่ถึงเกณฑ์ '
                    f"(ต้อง ≥{EXTREME_PCTILE:g} หรือ ≤{100 - EXTREME_PCTILE:g} · "
                    f"ที่อ้างมา: {pctiles or 'ไม่มี'})"))

        for w in SUPERLATIVE_WORDS:
            if w in text and not any(p >= SUPERLATIVE_PCTILE or p <= 100 - SUPERLATIVE_PCTILE
                                     for p in pctiles):
                out.append(Finding(
                    4, "unbacked_adjective", where,
                    f'ใช้คำว่า "{w}" ซึ่งเป็นการอ้างว่าสุดขั้ว ต้องมีเปอร์เซ็นไทล์ '
                    f"≥{SUPERLATIVE_PCTILE:g} หรือ ≤{100 - SUPERLATIVE_PCTILE:g} รองรับ "
                    f"(ที่อ้างมา: {pctiles or 'ไม่มี'})"))

        for w in LEADER_WORDS:
            if w in text and not has_rank_top:
                out.append(Finding(
                    4, "unbacked_adjective", where,
                    f'ใช้คำว่า "{w}" แต่ไม่ได้อ้าง fact อันดับต้น (rank.*_top.*)'))

        # ขาดลอย: ปลายแถบ แต่เกณฑ์ต่ำกว่า "ผิดปกติ"
        for w in WIDE_WORDS:
            if w in text and not any(p >= WIDE_PCTILE or p <= 100 - WIDE_PCTILE
                                     for p in pctiles):
                out.append(Finding(
                    4, "unbacked_adjective", where,
                    f'ใช้คำว่า "{w}" ต้องมีเปอร์เซ็นไทล์ ≥{WIDE_PCTILE:g} '
                    f"หรือ ≤{100 - WIDE_PCTILE:g} รองรับ "
                    f"(ที่อ้างมา: {pctiles or 'ไม่มี'})"))

        # ปริมาณซื้อขาย: ต้องอ้าง vol.week ของกองนั้นและต้องถึงเกณฑ์
        for w in VOLUME_WORDS:
            if w not in text:
                continue
            zs = [f.value for f in cited
                  if f.id.startswith("volw.") and f.id.endswith(".z")
                  and f.value is not None]
            rv = [f.value for f in cited
                  if f.id.startswith("volw.") and f.id.endswith(".rvol")
                  and f.value is not None]
            if not (any(z >= VOL_Z_MIN for z in zs)
                    or any(r >= VOL_RVOL_MIN for r in rv)):
                out.append(Finding(
                    4, "unbacked_adjective", where,
                    f'ใช้คำว่า "{w}" ต้องอ้างปริมาณซื้อขายรายสัปดาห์ที่ถึงเกณฑ์ '
                    f"(z ≥{VOL_Z_MIN:g} หรือ {VOL_RVOL_MIN:g} เท่าของฐาน · "
                    f"ที่อ้างมา z={zs or 'ไม่มี'} เท่า={rv or 'ไม่มี'})"))

        # ความกว้างของตลาดแย่ลง: ต้องมีทั้งระดับที่ต่ำกว่าครึ่ง และทิศทางที่ลง
        #
        # ผ่อนแบบมีเงื่อนไข (รอบ B2b-1.2 · 16 พ.ย. 2026)
        #
        # เดิมบังคับว่าค่าล่าสุดต้องอยู่ในรายการ fact ของประโยคเดียวกับคำขยาย
        # ด้วยเหตุผลว่า "คำนั้นกำลังตัดสินตัวเลขนั้น" (มติ 21) · รอบซ้อมบน
        # main คืน 16 พ.ย. โมเดลเขียนความจริงครบทั้งสองค่าแต่แยกสองประโยค
        # แล้วคำว่า "อ่อนแอลง" ไปตกอยู่ในประโยคของ "ค่าเทียบ":
        #   ป.1 "...อยู่ที่ 45.16% (42 จาก 93 กอง)"      → อ้าง breadth.today.*
        #   ป.2 "ซึ่งอ่อนแอลง เมื่อเทียบกับ 21 วันก่อน..." → อ้าง breadth.prior_21d.*
        # บทสรุปถูกกักทั้งที่ไม่มีอะไรผิด — เป็นบทเรียนเดียวกับ _section_pools
        # ("ด่านที่คำตัดสินขึ้นกับตำแหน่งจุดฟูลสต็อปกำลังวัดสไตล์") แต่สลับข้าง
        #
        # เงื่อนไขที่ยังเหลือไว้: ประโยคที่มีคำขยายต้องอ้าง fact ความกว้าง
        # อย่างน้อยหนึ่งตัว คำจึงยังเกาะอยู่กับเรื่องที่มันตัดสิน · ประโยคที่
        # พูดว่าอ่อนแอลงโดยไม่อ้างความกว้างเลย (เช่นพูดถึงกองทุนรายตัว) ยัง
        # ถูกกักเหมือนเดิม · ด่าน 1 ยังตรึงทุกตัวเลขกับประโยคของมันเอง
        for w in FRAGILE_WORDS:
            if w not in text:
                continue
            now = _value_in(cited, "breadth.today.pct")
            if now is None and any(f.id.startswith("breadth.") for f in cited):
                now = _value_in(pool_facts, "breadth.today.pct")
            was = _value_in(pool_facts, "breadth.prior_21d.pct")
            if now is None or was is None or not (now < BREADTH_WEAK_PCT and now < was):
                out.append(Finding(
                    4, "unbacked_adjective", where,
                    f'ใช้คำว่า "{w}" ต้องอ้าง fact ความกว้างของตลาดในประโยคนี้ '
                    f"และมีทั้งค่าล่าสุดกับค่า 21 วันก่อนอยู่ในหัวข้อเดียวกัน "
                    f"โดยล่าสุดต้องต่ำกว่า {BREADTH_WEAK_PCT:g}% "
                    f"และต่ำกว่าเดิม (ที่อ้างมา: ล่าสุด={now} เดิม={was})"))

        # แข็งแกร่ง: ต้องอ้างตำแหน่งราคาในกรอบ 1 ปีที่อยู่ช่วงบนจริง
        # ผูกกับ id ไม่ใช่กับหน่วย: breadth.today.pct ก็เป็น pct_level เหมือนกัน
        # และ 85% ของกองที่เหนือ SMA200 ไม่ได้พิสูจน์ว่ากองไหนแข็งแกร่ง
        for w in STRONG_WORDS:
            if w not in text:
                continue
            pos = [f.value for f in cited
                   if f.id.startswith("risk.") and f.id.endswith(".pos_52w")
                   and f.value is not None]
            if not any(p >= STRONG_POS_MIN for p in pos):
                out.append(Finding(
                    4, "unbacked_adjective", where,
                    f'ใช้คำว่า "{w}" ต้องอ้างตำแหน่งราคาในกรอบ 1 ปีที่ถึง '
                    f"{STRONG_POS_MIN:g} ขึ้นไป (ที่อ้างมา: {pos or 'ไม่มี'})"))

        # ขยายตัวชัด: ต้องอ้างเปอร์เซ็นไทล์ของ ATR ไม่ใช่เปอร์เซ็นไทล์อะไรก็ได้
        # (pair.*.pctile_3y ที่ 98 บอกเรื่องส่วนต่างของคู่ ไม่ได้บอกความผันผวน)
        for w in EXPAND_WORDS:
            if w not in text:
                continue
            atr = [f.value for f in cited
                   if f.id.startswith("risk.") and f.id.endswith(".atr_pctile_1y")
                   and f.value is not None]
            if not any(a >= EXPAND_ATR_PCTILE for a in atr):
                out.append(Finding(
                    4, "unbacked_adjective", where,
                    f'ใช้คำว่า "{w}" ต้องอ้างเปอร์เซ็นไทล์ของ ATR ในกรอบ 1 ปีที่ถึง '
                    f"{EXPAND_ATR_PCTILE:g} ขึ้นไป (ที่อ้างมา: {atr or 'ไม่มี'})"))

        # สวนทาง: ต้องมีตัวเลขสองตัวที่เครื่องหมายต่างกันจริง
        for w in DIVERGE_WORDS:
            if w not in text:
                continue
            vals = [f.value for f in cited
                    if f.value is not None and f.unit in ("pct", "pct_points")]
            if not (any(v > 0 for v in vals) and any(v < 0 for v in vals)):
                out.append(Finding(
                    4, "unbacked_adjective", where,
                    f'ใช้คำว่า "{w}" ต้องอ้างตัวเลขสองตัวที่ทิศทางต่างกัน '
                    f"(ที่อ้างมา: {vals or 'ไม่มี'})"))
    return out


# ---------------------------------------------------------------------------
# Gate 5 -- a seasonal number without its baseline is not information
# ---------------------------------------------------------------------------

# "สัปดาห์ที่ 46 ปิดบวก 60% ของปีที่ผ่านมา" อ่านเหมือนบอกอะไร แต่ถ้าทุกสัปดาห์
# ปิดบวก 58.9% ประโยคนั้นแปลว่า "ปกติ" ไม่ใช่ "น่าสนใจ" · เกณฑ์นี้บังคับให้
# ตัวเลขฤดูกาลเดินมาคู่กับฐานเทียบของงวดเดียวกันเสมอ ไม่ใช่เรื่องสไตล์การเขียน
SEASONAL_PERIOD = {"week_current": "week", "week_next": "week",
                   "month_current": "month", "month_next": "month"}


def gate5_seasonal(response: dict, sel: Selection) -> list[Finding]:
    out: list[Finding] = []
    for where, sentence in _sentences(response):
        ids = [str(f) for f in (sentence.get("facts") or [])]
        want = set()
        for fid in ids:
            parts = fid.split(".")
            if len(parts) >= 2 and parts[0] == "seasonal":
                period = SEASONAL_PERIOD.get(parts[1])
                if period:
                    want.add(period)
        for period in sorted(want):
            prefix = f"seasonal_baseline.{period}."
            if not any(fid.startswith(prefix) for fid in ids):
                out.append(Finding(
                    5, "seasonal_no_baseline", where,
                    f"อ้างสถิติฤดูกาลราย{'สัปดาห์' if period == 'week' else 'เดือน'} "
                    f"แต่ไม่ได้อ้างค่าปกติ ({prefix}*) มาเทียบในประโยคเดียวกัน"))
    return out


# ---------------------------------------------------------------------------

def validate(response: dict, sel: Selection) -> list[Finding]:
    """Gates 1-5 over a model response. Empty list means publishable."""
    return (gate1_numbers(response, sel)
            + gate2_tickers(response, sel)
            + gate3_language(response)
            + gate4_adjectives(response, sel)
            + gate5_seasonal(response, sel))


def to_text(response: dict) -> str:
    """Flatten the structure into the Thai body stored in daily_brief.body_th."""
    parts = []
    for section in response.get("sections") or []:
        heading = str(section.get("heading", "")).strip()
        body = " ".join(str(s.get("text", "")).strip()
                        for s in (section.get("sentences") or []))
        parts.append(f"{heading}\n{body}".strip() if heading else body)
    return "\n\n".join(p for p in parts if p)
