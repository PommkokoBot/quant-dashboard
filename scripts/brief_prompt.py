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
from brief_gates import (BODY_MAX_CHARS, BREADTH_WEAK_PCT, DIVERGE_WORDS,
                         EXPAND_ATR_PCTILE, EXPAND_WORDS,
                         EXTREME_PCTILE, EXTREME_WORDS, FORBIDDEN_TH,
                         FRAGILE_WORDS, LEADER_WORDS, STRONG_POS_MIN,
                         STRONG_WORDS, SUPERLATIVE_PCTILE,
                         SUPERLATIVE_WORDS, VAGUE_TIME_TH, VOL_RVOL_MIN,
                         VOL_Z_MIN, VOLUME_WORDS, WIDE_PCTILE, WIDE_WORDS)

PROMPT_VERSION = "v2.5"

# เป้าหมายจำนวนตัวเลขต่อหัวข้อ (รอบ B2b-1.1 · 16 พ.ย. 2026)
#
# วัดจากของจริง: บทสรุป 3 ฉบับที่เผยแพร่ไปแล้ว (34 ประโยค) มีตัวเลขต่อหัวข้อ
# สูงสุด 9 ตัว ค่ากลาง 6 · ฉบับซ้อมของ B2b-1 พุ่งไปที่ 27 (ภาพรวม) และ 21
# (เด่นและแย่) เพราะโมเดลไล่ 7 กอง × 4 กรอบเวลาเรียงกันหมด
#
# ตัวเลขนี้เป็น "เป้าหมายที่บอกโมเดล" ไม่ใช่ด่าน — ตั้งใจไม่ทำเป็นด่านในรอบนี้
# เพราะด่านที่นับตัวเลขจะกักบทสรุปที่ทุกตัวเลขถูกต้อง ซึ่งเป็นบทเรียนข้อ 10
# ("ด่านที่เข้มเกินไปจะกักของที่ถูกต้อง") · ถ้าซ้อมแล้วโมเดลยังไม่ทำตาม
# ค่อยยกเป็นด่าน โดยใช้เลขนี้เป็นเพดาน (เผื่อจากของจริง 9 → 12 คือ 33%)
SECTION_NUMBERS_TARGET = 12

# Changing the rules below changes what the model writes, so two briefs must
# never carry the same prompt_version with different instructions behind them.
# A test compares this against the rendered SYSTEM text: when it fails, update
# BOTH -- the fingerprint and the version right above it.
PROMPT_FINGERPRINT = "2e17ec031830"

# The sections, in order, with what each one is for. Written as part of the
# request rather than the system rules because this is the part most likely to
# change while the rules stay put. รอบ B2a เปลี่ยนหัวข้อ 1 จากรายวันเป็น
# รายสัปดาห์ และเพิ่มหัวข้อฤดูกาลเป็นหัวข้อที่ 6
SECTIONS = [
    ("ภาพรวม",
     "เลือกกองที่เล่าเรื่องของสัปดาห์นี้ได้ จากผลตอบแทน 1 สัปดาห์ 4 สัปดาห์ และ "
     "13 สัปดาห์ของ asset class หลักและ broad market แล้วเทียบกับแนวโน้ม 21 วัน · "
     "ไม่ต้องไล่ทุกกองทุกกรอบเวลา เลือกกองที่ต่างจากพวกมากที่สุดกับกองที่คนอ่าน "
     "ใช้เป็นหลัก (SPY) · ให้พูดเป็นสัปดาห์ก่อนเป็นวัน เพราะบทสรุปนี้เป็นรายสัปดาห์"),
    ("กลุ่มตามพฤติกรรม",
     "กลุ่ม Low Beta / Market Beta / High Beta / สวนทางตลาด กลุ่มไหนนำกลุ่มไหนตาม"),
    ("เด่นและแย่",
     "กองที่ผลตอบแทน 21 วันสูงสุดและต่ำสุด US sector ที่หัวแถวกับท้ายแถว "
     "และปริมาณซื้อขายรายสัปดาห์ของกองหัวแถวถ้ามีตัวเลขรองรับ · "
     "เลือกพูดหัวแถวกับท้ายแถวอย่างละไม่เกินสามกอง ไม่ต้องไล่ทั้งห้าอันดับ"),
    ("คู่เทียบ",
     "ส่วนต่างสามคู่พร้อมเปอร์เซ็นไทล์ ชี้ว่าคู่ไหนอยู่ในระดับที่ไม่ปกติ"),
    ("ความผันผวนและตำแหน่งราคา",
     "ATR และเปอร์เซ็นไทล์ของ ATR กับตำแหน่งราคาและระยะห่างจากจุดสูงสุด "
     "ของ asset class หลักและกองหัวแถว · ช่วงเทียบทั้งหมดในหัวข้อนี้คือกรอบ 1 ปี"),
    ("ความกว้างของตลาดและปฏิทิน",
     "สัดส่วนที่อยู่เหนือ SMA200 พร้อมตัวหารเสมอ และเหตุการณ์ที่กำหนดไว้ข้างหน้า"),
    ("สถิติฤดูกาล",
     "สถิติย้อนหลังของสัปดาห์ปัจจุบันและสัปดาห์ถัดไป เทียบกับค่าปกติของทุกสัปดาห์ "
     "ถ้ามีสถิติรายเดือนมาด้วยให้พูดถึงด้วย"),
]

def _words(items) -> str:
    return " ".join(items)


# The forbidden and conditional words come straight from the gates. Writing
# them out here by hand would mean the model is told one set of rules and
# judged by another, and the brief would be held every day over a wording
# nobody ever passed on to it.
SYSTEM = """คุณเขียนสรุปภาวะตลาด ETF รายสัปดาห์จากตัวเลขที่ได้รับเท่านั้น

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
6. คำประเมินต่อไปนี้ใช้ได้ต่อเมื่อประโยคเดียวกันอ้าง fact ที่ถึงเกณฑ์
   - {extreme}: ต้องมีเปอร์เซ็นไทล์ {ex_hi:g} ขึ้นไป หรือ {ex_lo:g} ลงมา
   - {superlative}: ต้อง {sup_hi:g} ขึ้นไป หรือ {sup_lo:g} ลงมา
   - {wide}: ต้องมีเปอร์เซ็นไทล์ {wide_hi:g} ขึ้นไป หรือ {wide_lo:g} ลงมา
   - {leader}: ต้องอ้าง fact ที่เป็นอันดับต้น (rank.*_top.*)
   - {volume}: ต้องอ้างปริมาณซื้อขายรายสัปดาห์ของกองนั้น และต้องถึง
     z {vol_z:g} ขึ้นไป หรือ {vol_r:g} เท่าของฐานขึ้นไป
   - {fragile}: ประโยคนั้นต้องอ้าง fact ความกว้างของตลาดอย่างน้อยหนึ่งตัว
     และหัวข้อเดียวกันต้องมีทั้งค่าล่าสุดและค่า 21 วันก่อน โดยค่าล่าสุด
     ต้องต่ำกว่า {weak:g}% และต่ำกว่าค่าเดิม
   - {diverge}: ต้องอ้างตัวเลขสองตัวที่ทิศทางต่างกันจริงในประโยคเดียวกัน
   - {strong}: ต้องอ้างตำแหน่งราคาในกรอบ 1 ปีของกองนั้น (risk.*.pos_52w)
     และค่าต้องถึง {strong_min:g} ขึ้นไป
   - {expand}: ต้องอ้างเปอร์เซ็นไทล์ของ ATR ในกรอบ 1 ปีของกองนั้น
     (risk.*.atr_pctile_1y) และค่าต้องถึง {expand_min:g} ขึ้นไป
   ถ้าไม่ถึงเกณฑ์ ให้พูดเป็นตัวเลขเปล่า ๆ ไม่ต้องใส่คำประเมิน
7. ห้ามอธิบายสาเหตุ ห้ามคาดการณ์ ห้ามบอกว่าจะเกิดอะไรต่อ
8. ห้ามให้คะแนนความมั่นใจของตัวเอง
9. ห้ามเขียนรหัสภายในของข้อมูลลงในประโยค เช่น all_top us_sector week_next
   ให้บรรยายเป็นคำไทยที่คนอ่านเข้าใจ เช่น "สูงสุดของทั้งลิสต์"
   รหัสเหล่านั้นใส่ได้เฉพาะในช่อง facts
10. ตัวเลขสถิติฤดูกาล (seasonal.*) ใช้ได้ต่อเมื่อประโยคเดียวกันอ้างค่าปกติ
    ของงวดเดียวกันมาเทียบด้วย (seasonal_baseline.week.* หรือ
    seasonal_baseline.month.*) เพราะ "ชนะ 60%" ไม่มีความหมายจนกว่าจะรู้ว่า
    ค่าปกติคือเท่าไร
    กติกานี้ใช้กับทุกประโยคที่มีตัวเลขฤดูกาล ไม่ใช่เฉพาะประโยคแรกของหัวข้อ
    ถ้าหัวข้อพูดถึงสองงวด ต้องอ้างค่าปกติในประโยคของแต่ละงวด
11. สถิติฤดูกาลคือสิ่งที่เคยเกิดในอดีต ไม่ใช่สิ่งที่จะเกิด
    ให้เขียนในรูป "ในอดีต ... เคย ..." ห้ามเขียนว่าสัปดาห์หน้าจะเป็นอย่างไร
12. ตัวเลข risk.* ทุกตัวเทียบกับช่วงเดียวกัน ให้เรียกช่วงนั้นว่า "กรอบ 1 ปี"
    ห้ามเรียกเป็นจำนวนสัปดาห์หรือจำนวนวัน
13. เลือกสิ่งที่จะพูด อย่าไล่รายการ การที่ fact ถูกส่งมาให้ ไม่ได้แปลว่า
    ต้องเอ่ยถึงทุกตัว ตัวเลขที่ไม่ได้ช่วยเล่าเรื่องคือตัวเลขที่ควรตัดออก
    เป้าหมายคือหัวข้อหนึ่งมีตัวเลขไม่เกิน {sec_max} ตัว ถ้าเกิน ให้ตัดกองที่
    ค่าใกล้กับกองอื่นออก เก็บตัวที่ต่างจากพวกและตัวที่เป็นหลักของหัวข้อนั้นไว้
14. บอกลำดับด้วยการเรียงชื่อ ไม่ใช่ด้วยการแปะเลขอันดับ รูปที่ต้องการคือ
    "นำโดย AAA, BBB และ CCC ที่ +1.00%, +0.90% และ +0.80% ตามลำดับ"
    ห้ามเขียนคำว่า "อันดับ N" คลุมกองมากกว่าหนึ่งกองด้วยคำเดียว เพราะสองกอง
    ที่ปัดทศนิยมแล้วเท่ากัน ยังเป็นอันดับที่ต่างกันอยู่ ถ้าจำเป็นต้องระบุเลข
    อันดับจริง ให้เขียนทีละกองพร้อมเลขของกองนั้นเอง
15. ชื่อ fact id เป็นที่อยู่ของตัวเลข ไม่ใช่คำบอกความยาวของช่วงเวลา
    ห้ามเดาความยาวของช่วงจากชื่อ id เช่น pctile_3y ไม่ได้แปลว่า "3 ปี"
    ถ้าจะบอกว่าเปอร์เซ็นไทล์คิดจากช่วงยาวเท่าไร ให้ใช้จำนวนวันจาก fact ที่
    บอกไว้ (pair.*.n_days) เท่านั้น หรือไม่ต้องบอกความยาวของช่วงเลย
    และคำว่า "กรอบ 1 ปี" ในข้อ 12 ใช้กับตัวเลข risk.* เท่านั้น
    ห้ามดัดแปลงเป็น "กรอบ N ปี" กับตัวเลขกลุ่มอื่น

ภาษา เขียนภาษาไทย แต่คง ticker และศัพท์เทคนิคไว้เป็นภาษาอังกฤษ
เช่น SPY, Breadth, Momentum, Low Beta, SMA200, drawdown
คนอ่านอยู่ในวงการ ไม่ต้องแปลศัพท์พวกนี้

ความยาว รวมทุกหัวข้อไม่เกิน {maxchars:,} ตัวอักษร แต่ละหัวข้อ 2 ถึง 5 ประโยค
และตัวเลขต่อหัวข้อไม่เกิน {sec_max} ตัวตามกติกาข้อ 13
เขียนให้อ่านรู้เรื่องเป็นย่อหน้า ไม่ใช่ลำดับตัวเลขเรียงกัน แต่ทุกคำขยาย
ต้องมีตัวเลขในประโยคเดียวกันรองรับตามกติกาข้อ 6

รูปแบบคำตอบ ตอบเป็น JSON อย่างเดียว ห้ามมีข้อความอื่นนอก JSON
{{"sections":[{{"heading":"ชื่อหัวข้อ","sentences":[{{"text":"ประโยค","facts":["fact id"]}}]}}]}}""".format(
    forbidden=_words(FORBIDDEN_TH),
    vague=_words(VAGUE_TIME_TH),
    extreme=_words(EXTREME_WORDS),
    superlative=_words(SUPERLATIVE_WORDS),
    leader=_words(LEADER_WORDS),
    ex_hi=EXTREME_PCTILE, ex_lo=100 - EXTREME_PCTILE,
    sup_hi=SUPERLATIVE_PCTILE, sup_lo=100 - SUPERLATIVE_PCTILE,
    wide=_words(WIDE_WORDS),
    wide_hi=WIDE_PCTILE, wide_lo=100 - WIDE_PCTILE,
    volume=_words(VOLUME_WORDS), vol_z=VOL_Z_MIN, vol_r=VOL_RVOL_MIN,
    fragile=_words(FRAGILE_WORDS), weak=BREADTH_WEAK_PCT,
    diverge=_words(DIVERGE_WORDS),
    strong=_words(STRONG_WORDS), strong_min=STRONG_POS_MIN,
    expand=_words(EXPAND_WORDS), expand_min=EXPAND_ATR_PCTILE,
    sec_max=SECTION_NUMBERS_TARGET,
    maxchars=BODY_MAX_CHARS,
)


def _fmt(value: float, unit: str) -> str:
    if unit == "count":
        return f"{value:g}"
    if unit == "pctile":
        return f"{value:.2f} (เปอร์เซ็นไทล์)"
    if unit == "pct":
        return f"{value:+.2f}%"
    if unit == "pct_level":
        # สัดส่วน ไม่ใช่การเปลี่ยนแปลง · เครื่องหมาย + หน้าค่าแบบนี้
        # ("+46.24%") ชวนให้อ่านว่าเพิ่มขึ้น 46% ซึ่งไม่ใช่สิ่งที่ค่านี้บอก
        return f"{value:.2f}%"
    if unit == "pct_points":
        return f"{value:+.2f} จุด"
    if unit == "sigma":
        return f"{value:+.2f} ส่วนเบี่ยงเบน"
    if unit == "times":
        return f"{value:.2f} เท่า"
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

    lines += ["", f"เขียน {len(SECTIONS)} หัวข้อตามลำดับนี้"]
    for i, (heading, what) in enumerate(SECTIONS, start=1):
        lines.append(f"{i}. {heading} — {what}")

    lines += [
        "",
        "ใช้ชื่อหัวข้อตามที่กำหนดเป๊ะ ๆ และห้ามเพิ่มหัวข้ออื่น",
        "ถ้าหัวข้อไหนไม่มี fact รองรับพอ ให้เขียนสั้นที่สุดเท่าที่ fact มี "
        "อย่าเติมเนื้อหาที่ไม่มีตัวเลขรองรับ",
    ]
    return "\n".join(lines)
