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
  GEMINI_MODEL                              optional override of the model id
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID      where the result is reported

Usage:
  python scripts/brief.py --ping        list the models this key may use, stop
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
import time
from datetime import date, datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import brief_facts as bf
import brief_gates as bg
import brief_prompt as bp
import notify

# Overridable so a model can be swapped from the workflow without a code change
# -- useful precisely when the configured one turns out not to exist.
MODEL = os.environ.get("GEMINI_MODEL") or "gemini-3.8-flash"

# Gemini 3 Flash thinks before answering and cannot be told to stop entirely --
# "low" is the floor the model accepts ("minimal" is rejected on 3.8 Flash, and
# thinkingBudget: 0 only works on the 2.5 family). The level matters for more
# than speed: thought tokens are spent out of maxOutputTokens, so a model left
# to think freely can use up the budget and return a truncated brief, or none.
THINKING_LEVEL = os.environ.get("GEMINI_THINKING_LEVEL") or "low"

# Generous on purpose. The brief itself is ~2k characters, but this ceiling is
# shared with the thinking above, and hitting it produces an empty answer that
# still costs money -- the opposite of a saving.
MAX_OUTPUT_TOKENS = 16384

API_BASE = "https://generativelanguage.googleapis.com/v1beta"
API_URL = API_BASE + "/models/{model}:generateContent"
LIST_URL = API_BASE + "/models"

# Split, because the two failures mean completely different things: a connect
# timeout says the runner cannot reach Google at all, a read timeout says it
# got through and the model is simply taking its time. The first run of this
# script hit a 120s read timeout and could not tell us which.
CONNECT_TIMEOUT_S = 15
READ_TIMEOUT_S = 300
BANGKOK = timezone(timedelta(hours=7))


# --------------------------------------------------------------------------
# the model call -- the only part of this file that touches the network
# --------------------------------------------------------------------------

def build_body(system: str, user: str) -> dict:
    """The request, built without touching the network so a test can read it.

    Kept separate because every field in here has already cost us a run: the
    mime type, the token ceiling and the thinking level each decide whether an
    answer comes back at all, and none of them are visible in a log.
    """
    return {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
            "thinkingConfig": {"thinkingLevel": THINKING_LEVEL},
        },
    }


def extract_text(data: dict) -> str:
    """The model's text, or an error that says what actually went wrong.

    Worth the length. A brief cut off mid-thought arrives as a candidate with
    finishReason MAX_TOKENS and no usable text, and the obvious reading of that
    -- "the response shape is wrong" -- sends you looking at the parser instead
    of at the token ceiling. Thought parts are skipped rather than concatenated,
    so turning on thought summaries later cannot quietly corrupt the JSON.
    """
    cand = (data.get("candidates") or [{}])[0]
    reason = str(cand.get("finishReason") or "")
    parts = (cand.get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts
                   if isinstance(p, dict) and not p.get("thought"))

    if reason == "MAX_TOKENS":
        usage = json.dumps(data.get("usageMetadata") or {}, ensure_ascii=False)
        raise RuntimeError(
            f"Gemini ชนเพดาน maxOutputTokens ({MAX_OUTPUT_TOKENS}) กลางทาง "
            f"— เพดานนี้นับ thought token ด้วย · usage={usage} · "
            f"ทางแก้: ลด GEMINI_THINKING_LEVEL (ตอนนี้ {THINKING_LEVEL}) "
            f"หรือเพิ่ม MAX_OUTPUT_TOKENS")

    if not text.strip():
        raise RuntimeError(
            f"Gemini ไม่ได้ส่งข้อความกลับมา (finishReason="
            f"{reason or 'ไม่ระบุ'}): {json.dumps(data, ensure_ascii=False)[:400]}")
    return text


def call_model(system: str, user: str, api_key: str, model: str = MODEL) -> str:
    """Returns the raw text the model produced.

    The key travels in a header, never in the URL: Actions logs are public on
    this repo and a URL is the easiest thing in the world to end up in one.
    """
    import requests

    body = build_body(system, user)
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    url = API_URL.format(model=model)
    timeout = (CONNECT_TIMEOUT_S, READ_TIMEOUT_S)

    def post():
        started = time.monotonic()
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=timeout)
        finally:
            # Printed whether it worked or not: how long the model actually
            # takes is the number that decides what the timeout should be.
            print(f"  เรียก {model} ใช้เวลา {time.monotonic() - started:.1f} วินาที")
        return resp

    try:
        r = post()
    except requests.Timeout:
        print("  หมดเวลารอบแรก ลองอีกครั้ง")
        r = post()

    # Older endpoints reject responseMimeType. Losing it only means the model
    # may wrap its JSON in prose, which extract_json already copes with, so
    # one retry without it beats failing the day's brief over a field name.
    if r.status_code == 400 and "responseMimeType" in r.text:
        body["generationConfig"].pop("responseMimeType", None)
        r = post()

    # Same reasoning for the thinking level: the field name and its allowed
    # values are model-specific, so a model swap could make it invalid. Losing
    # it costs speed and risks a truncated answer, both of which beat losing
    # the day's brief to a rejected field.
    if r.status_code == 400 and "thinking" in r.text.lower():
        print("  รุ่นนี้ไม่รับ thinkingConfig ถอดออกแล้วลองใหม่")
        body["generationConfig"].pop("thinkingConfig", None)
        r = post()

    if r.status_code != 200:
        raise RuntimeError(f"Gemini ตอบ HTTP {r.status_code}: {r.text[:400]}")

    return extract_text(r.json())


def usable_models(payload: dict) -> list[str]:
    """Model ids from a ListModels response that can actually generate text.

    Pure, so the shape of the answer is pinned by a test rather than by one
    lucky call.
    """
    out = []
    for m in payload.get("models") or []:
        name = str(m.get("name", ""))
        methods = m.get("supportedGenerationMethods") or m.get("supportedActions") or []
        if name.startswith("models/") and (not methods or "generateContent" in methods):
            out.append(name[len("models/"):])
    return sorted(out)


def ping(api_key: str) -> int:
    """Ask the API which models this key may use, and how fast it answers.

    This is the lightest call the API has. Running it separates three failures
    the generateContent timeout could not: a runner with no route to Google
    (this hangs too), a key without access (this returns 401/403), and a model
    name that does not exist (this answers fine and the name is missing from
    the list).
    """
    import requests

    started = time.monotonic()
    try:
        r = requests.get(LIST_URL, headers={"x-goog-api-key": api_key},
                         timeout=(CONNECT_TIMEOUT_S, 60))
    except requests.Timeout:
        print(f"หมดเวลาหลัง {time.monotonic() - started:.1f} วินาที — "
              "แม้แต่คำขอที่เบาที่สุดก็ไม่มีคำตอบ "
              "แปลว่าเครื่องที่รันออกไปหา Google ไม่ได้ ไม่ใช่เรื่องของโมเดลหรือกุญแจ")
        return 1

    print(f"ตอบกลับใน {time.monotonic() - started:.1f} วินาที · HTTP {r.status_code}")
    if r.status_code != 200:
        print(r.text[:400])
        return 1

    models = usable_models(r.json())
    print(f"รุ่นที่บัญชีนี้ใช้ได้ {len(models)} รุ่น:")
    for name in models:
        mark = "  <-- ที่ตั้งไว้ตอนนี้" if name == MODEL else ""
        print(f"  {name}{mark}")
    if MODEL not in models:
        print(f"\n*** {MODEL} ไม่อยู่ในรายการ — นี่คือสาเหตุ ***")
        print("ตั้ง GEMINI_MODEL ใน Secrets เป็นชื่อจากรายการข้างบน แล้วรันใหม่")
        return 1
    return 0


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

    # Needs neither the database nor a fact sheet: it answers "can this runner
    # talk to Gemini at all, and under what model name".
    if "--ping" in args:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            sys.exit("ERROR: GEMINI_API_KEY must be set.")
        print(f"รุ่นที่ตั้งไว้: {MODEL}")
        return ping(key)

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
