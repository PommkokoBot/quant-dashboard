#!/usr/bin/env python3
"""
Writes the daily market brief: reads the day's fact sheet, asks Gemini to turn
it into Thai prose, runs every sentence through the gates, and stores the
result -- published only if nothing was found.

What this script is NOT allowed to do: compute anything. Every number it can
talk about was produced by the database and frozen into daily_facts, and the
model is handed those numbers rather than asked to work any out. The gates then
check the prose back against the same sheet. If a figure appears here that the
sheet does not contain, that is a bug, not a judgement call.

A failed gate means the brief is held, not fixed. Yesterday's row is left
exactly as it is, the findings go to validation_log and to Telegram, and a
person decides what to do. The one thing the system never does is publish text
whose numbers it could not verify.

Env vars:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   the fact sheet and the brief table
  GEMINI_API_KEY                            the model
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID      where the result is reported

Usage:
  python scripts/brief.py --dry-run     build the prompt, print it, stop
  python scripts/brief.py --no-write    call the model and the gates, print, stop
  python scripts/brief.py               the whole thing
  python scripts/brief.py --force       rebuild even if the day already has one
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import brief_facts as bf
import brief_gates as bg
import brief_prompt as bp
import notify

MODEL = "gemini-3.8-flash"
API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT_S = 120
BANGKOK = timezone(timedelta(hours=7))


# --------------------------------------------------------------------------
# the model call -- the only part of this file that touches the network
# --------------------------------------------------------------------------

def call_model(system: str, user: str, api_key: str, model: str = MODEL) -> str:
    """Returns the raw text the model produced.

    The key travels in a header, never in the URL: Actions logs are public on
    this repo and a URL is the easiest thing in the world to end up in one.
    """
    import requests

    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"responseMimeType": "application/json",
                             "maxOutputTokens": 4096},
    }
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    url = API_URL.format(model=model)

    r = requests.post(url, headers=headers, json=body, timeout=TIMEOUT_S)
    # Older endpoints reject responseMimeType. Losing it only means the model
    # may wrap its JSON in prose, which extract_json already copes with, so
    # one retry without it beats failing the day's brief over a field name.
    if r.status_code == 400 and "responseMimeType" in r.text:
        body["generationConfig"].pop("responseMimeType", None)
        r = requests.post(url, headers=headers, json=body, timeout=TIMEOUT_S)

    if r.status_code != 200:
        raise RuntimeError(f"Gemini ตอบ HTTP {r.status_code}: {r.text[:400]}")

    data = r.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as exc:
        raise RuntimeError(f"รูปคำตอบของ Gemini ไม่ใช่ที่คาด: {json.dumps(data)[:400]}") from exc


def extract_json(text: str) -> dict:
    """Parse the model's answer, tolerating a code fence around it."""
    stripped = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", stripped, re.S)
    if fence:
        stripped = fence.group(1)
    return json.loads(stripped)


# --------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------

def client():
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    return create_client(url, key)


def latest_trade_date(sb) -> str:
    return str((sb.rpc("data_as_of", {}).execute().data or {}).get("as_of"))


def ensure_sheet(sb, trade_date: str) -> dict | None:
    """Build the sheet if pg_cron has not got to it yet, then read it back.

    Calling the same function pg_cron calls -- not a second implementation of
    it -- is what keeps this safe to run at any hour (rule 7.2).
    """
    sb.rpc("build_daily_facts",
           {"p_trade_date": trade_date, "p_force": False}).execute()
    rows = (sb.table("daily_facts").select("facts")
            .eq("trade_date", trade_date).limit(1).execute().data)
    return rows[0]["facts"] if rows else None


def existing_brief(sb, trade_date: str) -> dict | None:
    rows = (sb.table("daily_brief").select("id,status")
            .eq("trade_date", trade_date).limit(1).execute().data)
    return rows[0] if rows else None


def store(sb, trade_date: str, row: dict, existing: dict | None) -> None:
    if existing:
        sb.table("daily_brief").update(row).eq("id", existing["id"]).execute()
    else:
        sb.table("daily_brief").insert({**row, "trade_date": trade_date}).execute()


# --------------------------------------------------------------------------
# messages
# --------------------------------------------------------------------------

def published_message(trade_date: str, body: str) -> str:
    return f"📝 บทสรุปข้อมูลวันที่ {trade_date} ผ่านด่านครบ\n\n{body}"


def held_message(trade_date: str, findings: list[bg.Finding]) -> str:
    lines = [f"⛔ บทสรุปข้อมูลวันที่ {trade_date} ไม่ผ่านด่าน {len(findings)} จุด "
             f"ยังไม่เผยแพร่ ฉบับก่อนหน้าไม่ถูกแตะ", ""]
    lines += [f.line() for f in findings[:12]]
    if len(findings) > 12:
        lines.append(f"… และอีก {len(findings) - 12} จุด (ดูใน validation_log)")
    return "\n".join(lines)


# --------------------------------------------------------------------------

def main() -> int:
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    no_write = "--no-write" in args
    force = "--force" in args

    sb = client()
    trade_date = latest_trade_date(sb)
    if not trade_date or trade_date == "None":
        print("ไม่ทราบวันที่ล่าสุดของข้อมูล — data_as_of() ไม่คืนค่า")
        return 1
    print(f"วันที่ของข้อมูล: {trade_date}")

    prior = existing_brief(sb, trade_date)
    if prior and prior["status"] == "published" and not force:
        # Weekends and holidays land here: data_as_of() still points at the
        # last trading day, whose brief was published when it was new.
        print(f"มีบทสรุปที่เผยแพร่แล้วของวันที่ {trade_date} — ไม่ทำซ้ำ")
        return 0

    sheet = ensure_sheet(sb, trade_date)
    if sheet is None:
        print(f"ไม่มีแผ่น fact ของวันที่ {trade_date} และสร้างไม่สำเร็จ")
        return 1

    g0 = bg.gate0_sheet(sheet, trade_date, bf.missing_groups(sheet))
    if g0:
        for f in g0:
            print(f.line())
        if not (dry_run or no_write):
            notify.send(held_message(trade_date, g0))
        return 1

    sel = bf.select_facts(sheet)
    user = bp.build_user(sel)
    print(f"fact ที่ส่งให้โมเดล: {len(sel.facts)} รายการ · "
          f"prompt {len(bp.SYSTEM) + len(user):,} ตัวอักษร")

    if dry_run:
        print("\n----- system -----\n" + bp.SYSTEM)
        print("\n----- user -----\n" + user)
        return 0

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("ERROR: GEMINI_API_KEY must be set.")

    raw = call_model(bp.SYSTEM, user, api_key)
    try:
        response = extract_json(raw)
    except json.JSONDecodeError as exc:
        print(f"โมเดลไม่ได้คืน JSON ที่อ่านได้: {exc}\n{raw[:500]}")
        if not no_write:
            notify.send(f"⛔ บทสรุปข้อมูลวันที่ {trade_date}: โมเดลไม่ได้คืน JSON ที่อ่านได้")
        return 1

    findings = bg.validate(response, sel)
    body = bg.to_text(response)
    status = "published" if not findings else "held"

    print(f"\n----- บทสรุป ({status}) -----\n{body}\n")
    for f in findings:
        print(f.line())

    if no_write:
        print("\n(--no-write: ไม่เขียนฐานข้อมูล ไม่ส่ง Telegram)")
        return 0

    store(sb, trade_date, {
        "publish_date": date.today().isoformat(),
        "body_th": body,
        "body_json": response,
        "model": MODEL,
        "prompt_version": bp.PROMPT_VERSION,
        "status": status,
        "validation_log": [f.__dict__ for f in findings],
    }, prior)

    notify.send(published_message(trade_date, body) if status == "published"
                else held_message(trade_date, findings))
    print(f"บันทึกแล้ว · สถานะ {status} · "
          f"{datetime.now(BANGKOK).strftime('%-d %b %H:%M')}")
    # A held brief is the system working, not the system breaking: the gates
    # did their job and Telegram carries the reason. Only a real failure --
    # no sheet, the model unreachable, an answer that is not JSON -- returns
    # non-zero, so a red run keeps meaning "something needs fixing".
    return 0


if __name__ == "__main__":
    sys.exit(main())
