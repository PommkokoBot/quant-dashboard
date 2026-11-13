#!/usr/bin/env python3
"""สร้างแผ่น fact ของวันล่าสุด และเก็บวันที่ยังขาดย้อนหลัง

ทำไมต้องมีสเตปนี้ใน daily-fetch ทั้งที่ pg_cron ก็สร้างแผ่นอยู่แล้ว
---------------------------------------------------------------
pg_cron เดินตรวจทุก 30 นาทีในหน้าต่าง 04:00-08:30 UTC ซึ่งเป็นการเดาว่า
ราคาจะลงฐานข้อมูลภายในหน้าต่างนั้น · แต่เวลาที่ราคาลงจริงขึ้นกับคิวของ
GitHub Actions ซึ่งวัดได้ว่าช้าตั้งแต่ 1.9 ถึง 10.5 ชั่วโมง และเคยเปลี่ยน
พฤติกรรมกลางทางมาแล้วหนึ่งครั้ง (10 ต.ค. 2026) · วันที่ราคาลงหลัง 08:30
แผ่นของวันนั้นจะไม่ถูกสร้างเลย

สเตปนี้สั่งสร้างทันทีที่ราคาลงเสร็จ ในจ็อบเดียวกัน จึงไม่ต้องเดาเวลา
pg_cron ยังอยู่ต่อในฐานะตัวสำรองสำหรับวันที่จ็อบนี้ไม่ได้รันเลย

ทำไมด่านปฏิเสธแล้วยังคืน 0
-------------------------
"ราคามาไม่ครบ จึงยังไม่สร้างแผ่น" คือระบบทำงานถูก ไม่ใช่ระบบพัง
ถ้าทำให้จ็อบแดง สีแดงจะเลิกมีความหมายภายในไม่กี่สัปดาห์ (เหตุผลเดียวกับ
บทสรุปที่ถูกกักแล้วยัง exit 0) · คนที่รายงานเรื่องนี้คือ watchdog ตอน 09:00 UTC
ซึ่งมีด่านของตัวเองและส่ง Telegram อยู่แล้ว — ที่นี่ไม่ส่งซ้ำ

จะแดงก็ต่อเมื่อเรียกฐานข้อมูลไม่สำเร็จจริง ๆ เท่านั้น

Env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Usage:
  python scripts/build_facts.py
  python scripts/build_facts.py --days 20
"""
from __future__ import annotations

import argparse
import os
import sys

# ย้อนหลังกี่วันทำการ · 10 วันครอบวันหยุดยาวได้สบาย และเท่ากับช่วงที่
# fetch_prices.py ดึงย้อนหลังอยู่แล้ว จึงเป็นช่วงเดียวกับที่ราคามีโอกาสเติมเอง
DEFAULT_DAYS = 10


def summarize(rows: list[dict]) -> str:
    """ข้อความสรุปที่ไปโผล่ใน log ของ GitHub Actions"""
    if not rows:
        return "ไม่มีวันไหนขาดแผ่น — ไม่ต้องทำอะไร"

    created = [r for r in rows if r.get("created")]
    skipped = [r for r in rows if not r.get("created")]
    lines = [f"แตะทั้งหมด {len(rows)} วัน · สร้างใหม่ {len(created)} · ยังไม่สร้าง {len(skipped)}"]
    for r in rows:
        mark = "สร้างแล้ว" if r.get("created") else "ข้าม"
        lines.append(f"  {r.get('trade_date')}  {mark}  — {r.get('reason')}")
    return "\n".join(lines)


def run(client, days: int = DEFAULT_DAYS) -> list[dict]:
    """เรียก RPC ตัวเดียว · ตรรกะทั้งหมดอยู่ใน SQL ไม่ใช่ที่นี่

    สคริปต์นี้ตั้งใจไม่รู้จักคำว่า "ครบ" เลย — ถ้ารู้ ก็จะกลายเป็นนิยามชุดที่สอง
    ที่เดินห่างจาก coverage_report() ได้ (กติกาข้อ 7.2)
    """
    return client.rpc("catch_up_daily_facts", {"p_days": days}).execute().data or []


def get_client():
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    return create_client(url, key)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build any missing daily fact sheets.")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS,
                        help="จำนวนวันทำการย้อนหลังที่จะไล่ดู")
    args = parser.parse_args()

    rows = run(get_client(), args.days)
    print(summarize(rows))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())
