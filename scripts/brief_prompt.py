"""The prompt, kept in one place and versioned.

Every brief records the prompt_version that produced it, so a change in tone or
a new rule can always be traced to the exact instructions in force that day.
Bump PROMPT_VERSION whenever the text below changes in a way that could change
what the model writes -- fixing a typo in a comment does not count, changing a
rule does.

Nothing here talks to anything: a Selection goes in, two strings come out.
"""
from __future__ import annotations

from brief_facts import Selection
from brief_gates import (EXTREME_PCTILE, EXTREME_WORDS, FORBIDDEN_TH,
                         LEADER_WORDS, SUPERLATIVE_PCTILE, SUPERLATIVE_WORDS,
                         VAGUE_TIME_TH)

PROMPT_VERSION = "v1"

# Changing the rules below changes what the model writes, so two briefs must
# never carry the same prompt_version with different instructions behind them.
# A test compares this against the rendered SYSTEM text: when it fails, update
# BOTH -- the fingerprint and the version right above it.
PROMPT_FINGERPRINT = "d38c14c60bcd"

# The five sections, in order, with what each one is for. Written as part of
# the request rather than the system rules because this is the part most likely
# to change while the rules stay put.
SECTIONS = [
    ("ภาพรวม",
     "การเคลื่อนไหวของวันและแนวโน้ม 21 วันของ asset class หลักและ broad market"),
    ("กลุ่มตามพฤติกรรม",
     "กลุ่ม Low Beta / Market Beta / High Beta / สวนทางตลาด กลุ่มไหนนำกลุ่มไหนตาม"),
    ("เด่นและแย่",
     "กองที่ผลตอบแทน 21 วันสูงสุดและต่ำสุด และ US sector ที่หัวแถวกับท้ายแถว"),
    ("คู่เทียบ",
     "ส่วนต่างสามคู่พร้อมเปอร์เซ็นไทล์ ชี้ว่าคู่ไหนอยู่ในระดับที่ไม่ปกติ"),
    ("ความกว้างของตลาดและปฏิทิน",
     "สัดส่วนที่อยู่เหนือ SMA200 พร้อมตัวหารเสมอ และเหตุการณ์ที่กำหนดไว้ข้างหน้า"),
]

def _words(items) -> str:
    return " ".join(items)


# The forbidden and conditional words come straight from the gates. Writing
# them out here by hand would mean the model is told one set of rules and
# judged by another, and the brief would be held every day over a wording
# nobody ever passed on to it.
SYSTEM = """คุณเขียนสรุปภาวะตลาด ETF ประจำวันจากตัวเลขที่ได้รับเท่านั้น

กติกาที่ห้ามฝ่าฝืน

1. ใช้ได้เฉพาะตัวเลขในรายการ fact ที่ให้มา ห้ามคำนวณค่าใหม่ ห้ามประมาณ
   ห้ามดึงความรู้ของคุณเองเรื่องตลาด บริษัท หรือข่าวมาใส่แม้แต่ประโยคเดียว
2. ทุกประโยคต้องระบุ fact id ที่ใช้ในช่อง facts ถ้าประโยคไหนไม่มีตัวเลข
   ให้ระบุ fact id ที่ประโยคนั้นอ้างอิงถึงอยู่ดี
3. เขียนตัวเลขให้ตรงกับค่าที่ให้มา ปัดทศนิยมได้ไม่เกิน 2 ตำแหน่ง
   ถ้าค่าติดลบแต่คุณเขียนเป็นจำนวนบวก ต้องมีคำบอกทิศทางลงในประโยคเดียวกัน
   เช่น ลดลง ติดลบ ตามหลัง ต่ำกว่า
4. หน้าที่คุณคือบอกสิ่งที่ตัวเลขแสดง ไม่ใช่สิ่งที่ควรทำ
   ห้ามใช้คำเหล่านี้เด็ดขาด: {forbidden}
   และห้ามใช้คำภาษาอังกฤษว่า buy sell accumulate undervalued overvalued
   overweight underweight recommend target price
5. ห้ามใช้คำว่า {vague}
   เพราะผู้อ่านอ่านคนละวันกับวันของข้อมูล ให้ระบุวันที่จริงแทน
6. คำประเมินต่อไปนี้ใช้ได้ต่อเมื่อประโยคนั้นอ้างเปอร์เซ็นไทล์ที่ถึงเกณฑ์
   - {extreme}: ต้องมีเปอร์เซ็นไทล์ {ex_hi:g} ขึ้นไป หรือ {ex_lo:g} ลงมา
   - {superlative}: ต้อง {sup_hi:g} ขึ้นไป หรือ {sup_lo:g} ลงมา
   - {leader}: ต้องอ้าง fact ที่เป็นอันดับต้น (rank.*_top.*)
   ถ้าไม่ถึงเกณฑ์ ให้พูดเป็นตัวเลขเปล่า ๆ ไม่ต้องใส่คำประเมิน
7. ห้ามอธิบายสาเหตุ ห้ามคาดการณ์ ห้ามบอกว่าจะเกิดอะไรต่อ
8. ห้ามให้คะแนนความมั่นใจของตัวเอง

ภาษา เขียนภาษาไทย แต่คง ticker และศัพท์เทคนิคไว้เป็นภาษาอังกฤษ
เช่น SPY, Breadth, Momentum, Low Beta, SMA200, drawdown
คนอ่านอยู่ในวงการ ไม่ต้องแปลศัพท์พวกนี้

ความยาว รวมทุกหัวข้อประมาณ 180 ถึง 250 คำ แต่ละหัวข้อ 1 ถึง 3 ประโยค

รูปแบบคำตอบ ตอบเป็น JSON อย่างเดียว ห้ามมีข้อความอื่นนอก JSON
{{"sections":[{{"heading":"ชื่อหัวข้อ","sentences":[{{"text":"ประโยค","facts":["fact id"]}}]}}]}}""".format(
    forbidden=_words(FORBIDDEN_TH),
    vague=_words(VAGUE_TIME_TH),
    extreme=_words(EXTREME_WORDS),
    superlative=_words(SUPERLATIVE_WORDS),
    leader=_words(LEADER_WORDS),
    ex_hi=EXTREME_PCTILE, ex_lo=100 - EXTREME_PCTILE,
    sup_hi=SUPERLATIVE_PCTILE, sup_lo=100 - SUPERLATIVE_PCTILE,
)


def _fmt(value: float, unit: str) -> str:
    if unit == "count":
        return f"{value:g}"
    if unit == "pctile":
        return f"{value:.2f} (เปอร์เซ็นไทล์)"
    if unit == "pct":
        return f"{value:+.2f}%"
    if unit == "pct_points":
        return f"{value:+.2f} จุด"
    return f"{value:g}"


def build_user(sel: Selection) -> str:
    """The day's facts plus the shape of the answer."""
    lines = [
        f"วันที่ของข้อมูล {sel.trade_date}",
        f"จำนวนกองที่ติดตาม {len(sel.universe)}",
        "",
        "รายการ fact ที่ใช้ได้ (id | คำอธิบาย | ค่า)",
    ]
    for f in sel.facts:
        value = f.text if f.value is None else _fmt(f.value, f.unit)
        lines.append(f"{f.id} | {f.label} | {value}")

    lines += ["", "เขียน 5 หัวข้อตามลำดับนี้"]
    for i, (heading, what) in enumerate(SECTIONS, start=1):
        lines.append(f"{i}. {heading} — {what}")

    lines += [
        "",
        "ใช้ชื่อหัวข้อตามที่กำหนดเป๊ะ ๆ และห้ามเพิ่มหัวข้ออื่น",
        "ถ้าหัวข้อไหนไม่มี fact รองรับพอ ให้เขียนสั้นที่สุดเท่าที่ fact มี "
        "อย่าเติมเนื้อหาที่ไม่มีตัวเลขรองรับ",
    ]
    return "\n".join(lines)
