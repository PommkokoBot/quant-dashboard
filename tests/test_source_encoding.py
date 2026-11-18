#!/usr/bin/env python3
"""ตรวจคุณสมบัติของซอร์สที่ไม่มีเทสต์อื่นมองเห็น และพังเฉพาะบนเครื่องบางเครื่อง

ข้อที่ไฟล์นี้ตรวจมีลักษณะว่า **มันเขียวบน runner เสมอ ไม่ว่าจะถูกหรือผิด**
จึงต้องตรวจจากตัวซอร์สโดยตรง ไม่ใช่จากพฤติกรรมตอนรัน

``encoding`` ของการอ่านเขียนไฟล์
   ``Path.read_text()`` และ ``open()`` ที่ไม่ระบุ encoding จะใช้ค่าเริ่มต้นของ
   ระบบ · บน runner ของ GitHub ค่านั้นคือ UTF-8 จึงไม่เคยพังที่นั่นเลย ·
   **บน Windows ภาษาไทยค่านั้นคือ cp874 แล้วพังทันทีกับไฟล์ UTF-8** —
   18 พ.ย. 2026 ``config/events.json`` ซึ่งมีภาษาไทย ทำให้ ``fetch_events.py``
   รันจากเครื่องของ Peat ไม่ได้เลย โดยไม่มีใครรู้มาก่อนเพราะมันรันผ่าน
   Actions เสมอ
   เทสต์นี้จึงอ่านด้วย ``ast`` ไม่ใช่ regex เพื่อให้ตรวจที่ตัวการเรียกจริง


พิสูจน์ว่าแดงได้: ถอด ``encoding="utf-8"`` ออกจากจุดใดจุดหนึ่งใน ``scripts/``
แล้วเทสต์นี้ต้องแดง (ทำจริงแล้วสองจุด 18 พ.ย. 2026)

หมายเหตุว่าทำไมไม่รวมการตรวจ ``noindex`` ของ ``index.html`` ไว้ที่นี่:
``tests/mutate_brief.py`` และ ``tests/mutate_watchdog.py`` คัดลอกเฉพาะ
``scripts/`` ``tests/`` ``.github/`` ไป temp dir แล้วรัน ``pytest tests`` ที่นั่น ·
เทสต์ที่อ่าน ``index.html`` จึงทำให้ baseline ของทั้งสองตัวแดงทันที ·
การตรวจหน้าเว็บจึงอยู่ที่ ``tests/test_security.js`` ซึ่งอ่าน ``index.html``
อยู่แล้วและมี ``tests/mutate_security.js`` พิสูจน์ว่าแดงได้ (M17)

Run:  pytest tests/test_source_encoding.py -q
"""
from __future__ import annotations

import ast
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCANNED_DIRS = ("scripts", "tests", "tools")
TEXT_IO_METHODS = {"read_text", "write_text"}


def python_files() -> list[Path]:
    found: list[Path] = []
    for name in SCANNED_DIRS:
        d = REPO / name
        if d.is_dir():
            found += sorted(d.rglob("*.py"))
    return found


def _has_encoding(call: ast.Call) -> bool:
    return any(kw.arg == "encoding" for kw in call.keywords)


def _is_binary_open(call: ast.Call) -> bool:
    """open(path, "rb") รับ encoding ไม่ได้ จึงต้องยกเว้น ไม่ใช่ปรับเป็น error"""
    mode = None
    if len(call.args) >= 2 and isinstance(call.args[1], ast.Constant):
        mode = call.args[1].value
    for kw in call.keywords:
        if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
            mode = kw.value.value
    return isinstance(mode, str) and "b" in mode


def offenders() -> list[str]:
    bad: list[str] = []
    for path in python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if isinstance(func, ast.Name) and func.id == "open":
                if not _is_binary_open(node) and not _has_encoding(node):
                    bad.append(f"{path.relative_to(REPO)}:{node.lineno} open()")
            elif isinstance(func, ast.Attribute) and func.attr in TEXT_IO_METHODS:
                if not _has_encoding(node):
                    bad.append(
                        f"{path.relative_to(REPO)}:{node.lineno} .{func.attr}()"
                    )
    return sorted(bad)


def test_the_scanner_actually_sees_some_files():
    """กันเทสต์ที่เขียวเพราะไม่ได้สแกนอะไรเลย"""
    files = python_files()
    assert len(files) >= 15, f"สแกนเจอแค่ {len(files)} ไฟล์ ซึ่งน้อยผิดปกติ"


def test_every_text_file_io_declares_encoding():
    bad = offenders()
    assert not bad, (
        "การอ่าน/เขียนไฟล์ข้อความต้องระบุ encoding=\"utf-8\" เสมอ "
        "ไม่งั้นจะพังบน Windows ภาษาไทย (cp874) โดยที่ CI ยังเขียว\n  "
        + "\n  ".join(bad)
    )
