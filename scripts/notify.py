#!/usr/bin/env python3
"""
Telegram notifier for Quant-Dashboard.

The single place that knows how to talk to Telegram. Everything that wants to
send a message (watchdog.py today, the daily-brief validator later) imports
`send` from here rather than building its own request, so there is one place to
change if the transport ever changes.

Deliberately NOT a bot that listens: this module only sends. Receiving commands
or button presses would need a public endpoint that is online all the time,
which this project does not have and (decision 2026-11-08) does not want.

Env vars required:
  TELEGRAM_BOT_TOKEN   from @BotFather -- NEVER commit this
  TELEGRAM_CHAT_ID     the chat the message goes to

Usage:
  python scripts/notify.py "test message"      # send a one-off message
  python scripts/notify.py --check             # verify token/chat without sending
"""
from __future__ import annotations

import argparse
import os
import sys

import requests

API_BASE = "https://api.telegram.org"
TIMEOUT_SECONDS = 20

# Telegram rejects anything longer than 4096 characters with a 400, which would
# turn "something is wrong" into "nothing arrived at all" -- the exact failure
# this tool exists to prevent. Long messages are cut instead.
MAX_MESSAGE_CHARS = 4000


class NotifyError(RuntimeError):
    """Raised when Telegram could not be reached or refused the message."""


def _credentials(token: str | None = None, chat_id: str | None = None) -> tuple[str, str]:
    token = token or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = chat_id or os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        raise NotifyError(
            "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in the environment."
        )
    return token, chat_id


def truncate(text: str, limit: int = MAX_MESSAGE_CHARS) -> str:
    """Cut an over-long message, keeping the beginning (where the alerts are)."""
    if len(text) <= limit:
        return text
    marker = "\n… (ตัดข้อความ)"
    return text[: limit - len(marker)] + marker


def send(text: str, token: str | None = None, chat_id: str | None = None) -> dict:
    """Send one message. Raises NotifyError on any failure.

    No parse_mode: the messages are Thai prose with tickers and percent signs in
    them, and Markdown/HTML parsing turns an unescaped character into a 400
    rather than into a slightly ugly message.
    """
    token, chat_id = _credentials(token, chat_id)
    try:
        response = requests.post(
            f"{API_BASE}/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": truncate(text),
                "disable_web_page_preview": True,
            },
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:  # network-level failure
        raise NotifyError(f"could not reach Telegram: {exc}") from exc

    if response.status_code != 200:
        # response.text can contain the chat id but never the token (it is in the
        # URL path, which requests does not echo back in .text).
        raise NotifyError(
            f"Telegram refused the message (HTTP {response.status_code}): {response.text[:300]}"
        )
    return response.json()


def check(token: str | None = None, chat_id: str | None = None) -> str:
    """Verify the token is valid without sending anything to the chat."""
    token, chat_id = _credentials(token, chat_id)
    try:
        response = requests.get(f"{API_BASE}/bot{token}/getMe", timeout=TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise NotifyError(f"could not reach Telegram: {exc}") from exc
    if response.status_code != 200:
        raise NotifyError(f"token rejected (HTTP {response.status_code})")
    username = response.json().get("result", {}).get("username", "?")
    return f"ok: bot @{username}, chat_id {chat_id}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a Telegram message.")
    parser.add_argument("text", nargs="?", help="message to send")
    parser.add_argument(
        "--check", action="store_true", help="verify credentials without sending"
    )
    args = parser.parse_args()

    try:
        if args.check:
            print(check())
            return 0
        if not args.text:
            parser.error("give a message to send, or use --check")
        send(args.text)
    except NotifyError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print("sent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
