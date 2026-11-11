#!/usr/bin/env python3
"""Shows what the brief machinery produces, without calling anything.

The model cannot be reached from a sandbox with no key, so this is how the
prompt and the gates get looked at by a person before any quota is spent: the
exact text that would be sent, then two hand-written answers -- one that passes
and one that does not -- put through the real gates and the real message
builders.

The facts are the ones the database held for 2026-11-09.

    python tests/rehearse_brief.py
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))
sys.path.insert(0, HERE)

import brief_facts as bf      # noqa: E402
import brief_gates as bg      # noqa: E402
import brief_prompt as bp     # noqa: E402
import brief as brief_main    # noqa: E402
from test_brief import sheet  # noqa: E402

TRADE_DATE = "2026-11-09"

GOOD = {"sections": [
    {"heading": "ภาพรวม", "sentences": [
        {"text": "ข้อมูลวันที่ 2026-11-09 SPY บวก 2.37% ในวันเดียว แต่ยังติดลบ 3.32% ในรอบ 21 วัน",
         "facts": ["ret.SPY.1d", "ret.SPY.21d"]},
        {"text": "QQQ บวกแรงกว่าที่ 3.54% ในวันเดียว ขณะที่รอบ 21 วันยังติดลบ 9.57%",
         "facts": ["ret.QQQ.1d", "ret.QQQ.21d"]}]},
    {"heading": "กลุ่มตามพฤติกรรม", "sentences": [
        {"text": "High Beta 30 กองเฉลี่ยติดลบ 11.02% ในรอบ 21 วัน ขณะที่ Low Beta 18 กองบวก 2.91%",
         "facts": ["beta.high_beta.avg_21d", "beta.high_beta.n",
                   "beta.low_beta.avg_21d", "beta.low_beta.n"]}]},
    {"heading": "เด่นและแย่", "sentences": [
        {"text": "PAWZ นำที่ 15.92% ในรอบ 21 วัน ส่วน CHAT ติดลบ 22.66%",
         "facts": ["rank.all_top.1", "rank.all_bottom.1"]},
        {"text": "ฝั่ง US sector XLV บวก 10.26% ขณะที่ XLK ติดลบ 14.04%",
         "facts": ["rank.us_sector.XLV", "rank.us_sector.XLK"]}]},
    {"heading": "คู่เทียบ", "sentences": [
        {"text": "QQQ ตามหลัง SPY 6.25 จุดในรอบ 21 วัน ซึ่งผิดปกติ ที่เปอร์เซ็นไทล์ 0.92 จาก 873 วัน",
         "facts": ["pair.qqq_spy.spread", "pair.qqq_spy.pctile_3y", "pair.qqq_spy.n_days"]},
        {"text": "ส่วนต่าง Low Beta − High Beta อยู่ที่ 13.92 จุด เปอร์เซ็นไทล์ 98.74 จาก 717 วัน",
         "facts": ["pair.lowbeta_highbeta.spread", "pair.lowbeta_highbeta.pctile_3y",
                   "pair.lowbeta_highbeta.n_days"]}]},
    {"heading": "ความกว้างของตลาดและปฏิทิน", "sentences": [
        {"text": "47 จาก 93 กองที่ติดตามอยู่เหนือ SMA200 คิดเป็น 50.54% ลดจาก 51 กองเมื่อ 21 วันก่อน",
         "facts": ["breadth.today.above", "breadth.today.universe",
                   "breadth.today.pct", "breadth.prior_21d.above"]},
        {"text": "ปฏิทินข้างหน้ามีประกาศ CPI สหรัฐ 2026-11-10 และวันหมดอายุออปชันรายเดือน 2026-11-20",
         "facts": ["events.1", "events.2"]}]},
]}

BAD = {"sections": [
    {"heading": "ภาพรวม", "sentences": [
        {"text": "วันนี้ SPY ปรับขึ้น 2.4% และ NVDA นำตลาด",
         "facts": ["ret.SPY.1d"]}]},
    {"heading": "คู่เทียบ", "sentences": [
        {"text": "ส่วนต่าง IWM − SPY กว้างผิดปกติที่ 4.60 จุด",
         "facts": ["pair.iwm_spy.spread", "pair.iwm_spy.pctile_3y"]},
        {"text": "QQQ นำ SPY อยู่ 6.25 จุด",
         "facts": ["pair.qqq_spy.spread"]}]},
    {"heading": "เด่นและแย่", "sentences": [
        {"text": "XLV น่าสะสมหลังบวก 10.26% ในรอบ 21 วัน",
         "facts": ["rank.us_sector.XLV"]}]},
]}


def show(title: str, response: dict, sel: bf.Selection) -> None:
    findings = bg.validate(response, sel)
    print("=" * 72)
    print(f"{title}   [พบปัญหา {len(findings)} จุด]")
    print("-" * 72)
    if findings:
        print(brief_main.held_message(TRADE_DATE, findings))
    else:
        print(brief_main.published_message(TRADE_DATE, bg.to_text(response)))
    print()


def main() -> int:
    s = sheet(TRADE_DATE)
    sel = bf.select_facts(s)
    user = bp.build_user(sel)

    print("=" * 72)
    print(f"PROMPT ที่จะถูกส่ง · prompt_version {bp.PROMPT_VERSION} "
          f"({bp.PROMPT_FINGERPRINT}) · fact {len(sel.facts)} รายการ · "
          f"{len(bp.SYSTEM) + len(user):,} ตัวอักษร")
    print("-" * 72)
    print("----- system -----")
    print(bp.SYSTEM)
    print("\n----- user -----")
    print(user)
    print()

    show("1. คำตอบที่ผ่านด่านครบ — นี่คือสิ่งที่จะเข้า Telegram", GOOD, sel)
    show("2. คำตอบที่มีปัญหา — นี่คือสิ่งที่จะเข้า Telegram แทน", BAD, sel)
    return 0


if __name__ == "__main__":
    sys.exit(main())
