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
  4  every evaluative adjective is backed by a percentile the sentence cites

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
    # v1 ไม่ได้ส่งข้อมูล volume ไปให้โมเดล จึงพิสูจน์คำนี้ไม่ได้ ห้ามใช้ไปก่อน
    "มาเร็ว",
]
FORBIDDEN_EN = [
    "buy", "sell", "accumulate", "undervalued", "overvalued",
    "overweight", "underweight", "recommend", "target price",
]

# บทสรุปถูกอ่านคนละวันกับวันที่ของข้อมูล และคิวของ GitHub ทำให้เวลาเผยแพร่
# ไม่แน่นอน คำเหล่านี้จึงกลายเป็นคำโกหกได้เองโดยไม่มีใครแก้อะไรเลย
VAGUE_TIME_TH = ["วันนี้", "เมื่อวาน", "พรุ่งนี้", "ตอนนี้", "ขณะนี้", "เมื่อเช้า"]

# ข้อ 11.5: คำประเมินทุกคำต้องผูกกับเกณฑ์ตัวเลขที่ตรวจด้วยเครื่องได้
EXTREME_WORDS = ["ผิดปกติ", "สูงผิดปกติ", "ต่ำผิดปกติ"]          # ต้องมี pctile >=95 หรือ <=5
SUPERLATIVE_WORDS = ["กว้างสุด", "แคบสุด", "สูงสุดในรอบ", "ต่ำสุดในรอบ"]  # ต้อง >=99 หรือ <=1
LEADER_WORDS = ["มาแรง"]                                          # ต้องอ้างอันดับต้น

EXTREME_PCTILE = 95.0
SUPERLATIVE_PCTILE = 99.0

# คำที่บอกทิศทางลง ใช้ตรวจว่าประโยคที่เขียนค่าสัมบูรณ์ของตัวเลขติดลบ
# ได้บอกทิศทางไว้จริง -- ตัวเลขถูกแต่ทิศผิดคือความผิดพลาดที่อันตรายที่สุด
NEGATIVE_WORDS = [
    "ติดลบ", "ลดลง", "ตามหลัง", "ต่ำกว่า", "แย่กว่า", "ร่วง", "ขาดทุน",
    "น้อยกว่า", "ถดถอย", "ลบ", "−", "-",
]

# ตัวพิมพ์ใหญ่ที่ไม่ใช่ ticker
NON_TICKERS = {
    "CPI", "PCE", "GDP", "ETF", "AI", "US", "FOMC", "SMA", "ATR", "RVOL",
    "OPEX", "NFCI", "PDPA", "QQQ_SPY", "EPS", "PMI", "ISM", "PPI",
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
    return out


# ---------------------------------------------------------------------------
# Gate 4 -- adjectives have to be earned
# ---------------------------------------------------------------------------

def gate4_adjectives(response: dict, sel: Selection) -> list[Finding]:
    out: list[Finding] = []
    index = sel.by_id()

    for where, sentence in _sentences(response):
        text = str(sentence.get("text", ""))
        cited = [index[f] for f in (sentence.get("facts") or []) if f in index]
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
    return out


# ---------------------------------------------------------------------------

def validate(response: dict, sel: Selection) -> list[Finding]:
    """Gates 1-4 over a model response. Empty list means publishable."""
    return (gate1_numbers(response, sel)
            + gate2_tickers(response, sel)
            + gate3_language(response)
            + gate4_adjectives(response, sel))


def to_text(response: dict) -> str:
    """Flatten the structure into the Thai body stored in daily_brief.body_th."""
    parts = []
    for section in response.get("sections") or []:
        heading = str(section.get("heading", "")).strip()
        body = " ".join(str(s.get("text", "")).strip()
                        for s in (section.get("sentences") or []))
        parts.append(f"{heading}\n{body}".strip() if heading else body)
    return "\n\n".join(p for p in parts if p)
