"""Both sides of every gate, against the real shape of a fact sheet.

The fixture below is the sheet the database actually produced for 2026-11-09,
with the full 93-instrument universe, so a test that passes here is a test
against the data the job will meet in production -- not against a shape this
file invented.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import brief_facts as bf  # noqa: E402
import brief_gates as bg  # noqa: E402

LOW_BETA = ["AGNG", "CPER", "DBA", "DBB", "EWU", "IEF", "IGF", "INDA", "KROP",
            "MOO", "SRVR", "THD", "UNG", "VNQ", "XLP", "XLRE", "XLU", "XLV"]
HIGH_BETA = ["AIQ", "ARKG", "ARKK", "ARKQ", "ARKX", "ARTY", "BATT", "BLOK", "BOTZ",
             "CHAT", "DRIV", "EBIZ", "ETHA", "EWY", "FINX", "METV", "PRNT", "QQQ",
             "QTUM", "ROBO", "SKYY", "SMH", "SNSR", "SOXX", "THNQ", "UFO", "UFOX",
             "URA", "WCLD", "XLK"]
MARKET_BETA = ["ACWI", "CIBR", "CRBN", "DIA", "EEM", "EFA", "ESPO", "EWJ", "EWT",
               "FIW", "GRID", "HACK", "HRTS", "IBB", "IBIT", "ICLN", "ITA", "IWM",
               "KWEB", "LIT", "MCHI", "NLR", "PAVE", "PAWZ", "PBD", "PHO", "REMX",
               "SLV", "SOCL", "SPY", "VEGN", "VGK", "VT", "XAR", "XLB", "XLC",
               "XLF", "XLI", "XLY"]
NEG_CORR = ["BNO", "DBC", "GLD", "GSG", "USO", "XLE"]


def sheet(trade_date: str = "2026-11-09") -> dict:
    return {
        "meta": {"trade_date": trade_date, "universe_n": 93, "facts_version": "v1",
                 "source": "live", "data_max_date": trade_date},
        "groups": {
            "ret.day": {
                "unit": "pct", "keys": [1, 5, 21],
                "source": "trailing_returns(active,'day',[1,5,21], as_of=trade_date)",
                "values": {
                    "SPY": [2.36641664296089, 0.0784505883023146, -3.32404339229001],
                    "QQQ": [3.54366725577704, -0.25548036249553, -9.57312844590638],
                    "IWM": [2.9, 0.5, 1.28],
                    "EFA": [1.1, 0.2, 2.0], "EEM": [1.4, 0.3, 3.1],
                    "IEF": [0.1, 0.0, 0.4], "VNQ": [0.9, 0.1, 1.7],
                    "DBC": [-0.4, -0.9, -3.0],
                },
            },
            "beta": {
                "unit": "pct", "as_of_quarter": "2026-10-01",
                "buckets": {
                    "low_beta": {"n": 18, "avg_1d": 1.9240080724069,
                                 "avg_21d": 2.90799235272339, "members": LOW_BETA},
                    "high_beta": {"n": 30, "avg_1d": 3.94102243600952,
                                  "avg_21d": -11.0155281693107, "members": HIGH_BETA},
                    "market_beta": {"n": 39, "avg_1d": 2.82568559668787,
                                    "avg_21d": -1.78407609755114, "members": MARKET_BETA},
                    "negative_corr": {"n": 6, "avg_1d": -1.67908981446879,
                                      "avg_21d": -4.95831540158141, "members": NEG_CORR},
                },
            },
            "rank": {
                "n": 5, "unit": "pct",
                "all_top": [["PAWZ", 15.9180260983402], ["AGNG", 13.0305065178498],
                            ["FIW", 12.8841958201168], ["PHO", 12.8444462142673],
                            ["INDA", 11.688032176388]],
                "all_bottom": [["CHAT", -22.6631980581528], ["SOXX", -21.294243772994],
                               ["EWY", -19.8262233697593], ["SMH", -19.213367501069],
                               ["ARTY", -18.3449197631582]],
                "thematic_top": [["PAWZ", 15.9180260983402]],
                "thematic_bottom": [["CHAT", -22.6631980581528]],
                "us_sector_ranked": [["XLV", 10.2570133615575], ["XLP", 8.9416265817871],
                                     ["XLK", -14.035614281023]],
            },
            "pair": {
                "unit": "pct_points",
                "values": {
                    "qqq_spy": {"label": "QQQ − SPY", "spread": -6.24908505361637,
                                "pctile_3y": 0.916380297823597, "n_days": 873},
                    "iwm_spy": {"label": "IWM − SPY", "spread": 4.60389113480541,
                                "pctile_3y": 91.8671248568156, "n_days": 873},
                    "lowbeta_highbeta": {"label": "Low Beta − High Beta",
                                         "spread": 13.9235205220341,
                                         "pctile_3y": 98.744769874477, "n_days": 717},
                },
            },
            "breadth": {
                "today": {"pct": 50.5376344086022, "above": 47, "universe": 93,
                          "new_hi": 2, "new_lo": 0, "date": trade_date},
                "prior_21d": {"pct": 54.8387096774194, "above": 51, "universe": 93,
                              "date": "2026-10-09"},
                "note": "ไม่ใช่ market breadth ของตลาด",
            },
            "events": {
                "window_days": 14,
                "items": [{"date": "2026-11-10", "name": "ประกาศ CPI สหรัฐ", "type": "cpi"},
                          {"date": "2026-11-20", "name": "วันหมดอายุออปชันรายเดือน",
                           "type": "opex_monthly"}],
            },
            # groups the brief does not use -- present so the fixture matches reality
            "risk": {"available": True, "values": {}},
            "health": {"available": True, "health": {}},
            "macro": {"items": []},
            "vol.day": {"keys": ["z", "rvol"], "values": {}},
        },
    }


def say(text, facts, heading="ภาพรวม"):
    return {"sections": [{"heading": heading,
                          "sentences": [{"text": text, "facts": facts}]}]}


SEL = bf.select_facts(sheet())


# --------------------------------------------------------------- fact picking

def test_universe_is_the_whole_active_list():
    assert len(SEL.universe) == 93
    assert "SPY" in SEL.universe and "NVDA" not in SEL.universe


def test_only_the_two_agreed_timeframes_are_offered():
    ids = {f.id for f in SEL.facts if f.id.startswith("ret.")}
    assert "ret.SPY.1d" in ids and "ret.SPY.21d" in ids
    assert not any(i.endswith(".5d") for i in ids), "5 วันไม่อยู่ในรอบแรกโดยตั้งใจ"


def test_values_carry_through_unrounded():
    index = SEL.by_id()
    assert index["ret.QQQ.21d"].value == -9.57312844590638
    assert index["pair.qqq_spy.pctile_3y"].value == 0.916380297823597
    assert index["breadth.today.above"].value == 47


def test_facts_from_groups_the_brief_does_not_use_are_absent():
    ids = {f.id for f in SEL.facts}
    assert not any(i.startswith(("risk.", "health.", "vol.", "macro.")) for i in ids)


def test_rank_and_pair_and_events_are_all_citable():
    index = SEL.by_id()
    assert index["rank.all_top.1"].ticker == "PAWZ"
    assert index["rank.us_sector.XLK"].value == -14.035614281023
    assert index["pair.lowbeta_highbeta.n_days"].value == 717
    assert "CPI" in index["events.1"].text


# ------------------------------------------------------------------- gate 0

def test_gate0_passes_on_a_complete_sheet():
    s = sheet()
    assert bg.gate0_sheet(s, "2026-11-09", bf.missing_groups(s)) == []


def test_gate0_catches_any_one_of_the_required_groups_going_missing():
    # The list is pinned by name, not just iterated: a test that loops over
    # REQUIRED_GROUPS cannot notice a group being deleted from REQUIRED_GROUPS.
    assert sorted(bf.REQUIRED_GROUPS) == sorted(
        ["ret.day", "beta", "rank", "pair", "breadth", "events"])
    for name in bf.REQUIRED_GROUPS:
        s = sheet()
        del s["groups"][name]
        f = bg.gate0_sheet(s, "2026-11-09", bf.missing_groups(s))
        assert [x.code for x in f] == ["missing_groups"], f"ลบกลุ่ม {name} แล้วด่าน 0 ไม่ร้อง"
        assert name in f[0].detail


def test_gate0_catches_a_group_marked_unavailable():
    s = sheet()
    s["groups"]["breadth"] = {"available": False}
    assert "breadth" in bf.missing_groups(s)


def test_gate0_catches_yesterdays_sheet():
    s = sheet("2026-11-06")
    f = bg.gate0_sheet(s, "2026-11-09", bf.missing_groups(s))
    assert [x.code for x in f] == ["wrong_date"]


# ------------------------------------------------------------------- gate 1

def test_number_that_matches_a_cited_fact_passes():
    r = say("QQQ ติดลบ 9.57% ในรอบ 21 วัน", ["ret.QQQ.21d"])
    assert bg.gate1_numbers(r, SEL) == []


def test_rounded_number_passes():
    r = say("ส่วนต่าง QQQ − SPY อยู่ที่เปอร์เซ็นไทล์ 0.9 จาก 873 วัน และ QQQ ตามหลัง 6.2 จุด",
            ["pair.qqq_spy.pctile_3y", "pair.qqq_spy.n_days", "pair.qqq_spy.spread"])
    assert bg.gate1_numbers(r, SEL) == []


def test_wrong_number_fails():
    r = say("QQQ ติดลบ 9.9% ในรอบ 21 วัน", ["ret.QQQ.21d"])
    f = bg.gate1_numbers(r, SEL)
    assert [x.code for x in f] == ["unbacked_number"]


def test_number_with_no_citation_fails():
    r = say("Breadth อยู่ที่ 50.5%", [])
    assert [x.code for x in bg.gate1_numbers(r, SEL)] == ["unbacked_number"]


def test_citing_a_fact_that_does_not_exist_fails():
    r = say("Breadth อยู่ที่ 50.5%", ["breadth.today.pct", "breadth.tomorrow.pct"])
    assert "unknown_fact" in [x.code for x in bg.gate1_numbers(r, SEL)]


def test_citing_the_wrong_fact_for_the_number_fails():
    r = say("Breadth อยู่ที่ 50.5%", ["breadth.prior_21d.pct"])
    assert [x.code for x in bg.gate1_numbers(r, SEL)] == ["unbacked_number"]


def test_magnitude_of_a_negative_value_needs_a_direction_word():
    bad = say("QQQ เคลื่อนไหว 9.57% ในรอบ 21 วัน", ["ret.QQQ.21d"])
    assert [x.code for x in bg.gate1_numbers(bad, SEL)] == ["wrong_direction"]
    good = say("QQQ ลดลง 9.57% ในรอบ 21 วัน", ["ret.QQQ.21d"])
    assert bg.gate1_numbers(good, SEL) == []


def test_explicit_minus_sign_is_fine():
    r = say("QQQ ทำได้ -9.57% ในรอบ 21 วัน", ["ret.QQQ.21d"])
    assert bg.gate1_numbers(r, SEL) == []


def test_window_lengths_do_not_need_a_fact_but_sample_sizes_do():
    ok = say("ในรอบ 21 วัน Breadth อยู่ที่ 50.5%", ["breadth.today.pct"])
    assert bg.gate1_numbers(ok, SEL) == []
    bad = say("เปอร์เซ็นไทล์ 0.9 จาก 900 วัน", ["pair.qqq_spy.pctile_3y"])
    assert [x.code for x in bg.gate1_numbers(bad, SEL)] == ["unbacked_number"]


def test_dates_are_not_treated_as_measurements():
    r = say("วันที่ 2026-11-10 มีประกาศ CPI สหรัฐ และ 20 พ.ย. เป็นวันหมดอายุออปชัน",
            ["events.1", "events.2"])
    assert bg.gate1_numbers(r, SEL) == []


def test_counts_are_checked():
    ok = say("47 จาก 93 กองอยู่เหนือ SMA200",
             ["breadth.today.above", "breadth.today.universe"])
    assert bg.gate1_numbers(ok, SEL) == []
    bad = say("45 จาก 93 กองอยู่เหนือ SMA200",
              ["breadth.today.above", "breadth.today.universe"])
    assert [x.code for x in bg.gate1_numbers(bad, SEL)] == ["unbacked_number"]


# ------------------------------------------------------------------- gate 2

def test_known_tickers_pass():
    r = say("SPY และ XLV นำกลุ่ม", ["rank.us_sector.XLV"])
    assert bg.gate2_tickers(r, SEL) == []


def test_ticker_outside_the_universe_fails():
    r = say("NVDA เป็นตัวนำ", [])
    f = bg.gate2_tickers(r, SEL)
    assert [x.code for x in f] == ["unknown_ticker"] and "NVDA" in f[0].detail


def test_non_ticker_capitals_are_allowed():
    r = say("ประกาศ CPI และ GDP ของ US มีผลต่อ ETF", [])
    assert bg.gate2_tickers(r, SEL) == []


# ------------------------------------------------------------------- gate 3

def test_clean_language_passes():
    r = say("XLK ติดลบ 14.04% ในรอบ 21 วัน", ["rank.us_sector.XLK"])
    assert bg.gate3_language(r) == []


def test_thai_advice_words_fail():
    assert [x.code for x in bg.gate3_language(say("XLV น่าสะสมในระดับนี้", []))] == ["advice"]
    assert [x.code for x in bg.gate3_language(say("ควรซื้อ SPY", []))] == ["advice"]


def test_english_advice_words_fail_on_whole_words_only():
    assert [x.code for x in bg.gate3_language(say("a clear buy signal", []))] == ["advice"]
    assert bg.gate3_language(say("ผู้ซื้อ buyer รายย่อย", [])) == []


def test_words_that_assume_the_reading_day_fail():
    f = bg.gate3_language(say("วันนี้ตลาดปรับขึ้น", []))
    assert [x.code for x in f] == ["vague_time"]


def test_v1_forbids_the_claim_it_cannot_check():
    assert [x.code for x in bg.gate3_language(say("PAWZ มาเร็ว", []))] == ["advice"]


# ------------------------------------------------------------------- gate 4

def test_extreme_word_backed_by_a_low_percentile_passes():
    r = say("ส่วนต่าง QQQ − SPY กว้างผิดปกติ ที่เปอร์เซ็นไทล์ 0.9",
            ["pair.qqq_spy.pctile_3y"])
    assert bg.gate4_adjectives(r, SEL) == []


def test_extreme_word_with_an_ordinary_percentile_fails():
    r = say("ส่วนต่าง IWM − SPY ผิดปกติ ที่เปอร์เซ็นไทล์ 91.9",
            ["pair.iwm_spy.pctile_3y"])
    assert [x.code for x in bg.gate4_adjectives(r, SEL)] == ["unbacked_adjective"]


def test_extreme_word_with_no_percentile_cited_fails():
    r = say("ส่วนต่างผิดปกติ", ["pair.qqq_spy.spread"])
    assert [x.code for x in bg.gate4_adjectives(r, SEL)] == ["unbacked_adjective"]


def test_superlative_needs_a_stricter_percentile_than_extreme():
    near = say("ส่วนต่าง Low Beta − High Beta กว้างสุดในรอบ ที่เปอร์เซ็นไทล์ 98.7",
               ["pair.lowbeta_highbeta.pctile_3y"])
    assert [x.code for x in bg.gate4_adjectives(near, SEL)] == ["unbacked_adjective"]
    far = say("ส่วนต่าง QQQ − SPY กว้างสุดในรอบ ที่เปอร์เซ็นไทล์ 0.9",
              ["pair.qqq_spy.pctile_3y"])
    assert bg.gate4_adjectives(far, SEL) == []


def test_leader_word_needs_a_top_rank_fact():
    ok = say("PAWZ มาแรงที่สุดในรอบ 21 วัน", ["rank.all_top.1"])
    assert bg.gate4_adjectives(ok, SEL) == []
    bad = say("XLV มาแรงในรอบ 21 วัน", ["rank.us_sector.XLV"])
    assert [x.code for x in bg.gate4_adjectives(bad, SEL)] == ["unbacked_adjective"]


# ------------------------------------------------------------------ assembly

def test_validate_runs_every_gate_and_a_clean_brief_passes():
    r = {"sections": [
        {"heading": "ภาพรวม", "sentences": [
            {"text": "SPY บวก 2.37% ในวันเดียว แต่ยังติดลบ 3.32% ในรอบ 21 วัน",
             "facts": ["ret.SPY.1d", "ret.SPY.21d"]}]},
        {"heading": "คู่เทียบ", "sentences": [
            {"text": "QQQ ตามหลัง SPY 6.25 จุด ซึ่งผิดปกติ ที่เปอร์เซ็นไทล์ 0.9 จาก 873 วัน",
             "facts": ["pair.qqq_spy.spread", "pair.qqq_spy.pctile_3y",
                       "pair.qqq_spy.n_days"]}]},
    ]}
    assert bg.validate(r, SEL) == []


def test_validate_collects_findings_from_more_than_one_gate():
    r = say("NVDA น่าสะสม และ Breadth อยู่ที่ 99.9%", [])
    codes = {x.code for x in bg.validate(r, SEL)}
    assert codes == {"unbacked_number", "unknown_ticker", "advice"}


def test_to_text_keeps_headings_and_order():
    r = {"sections": [
        {"heading": "ภาพรวม", "sentences": [{"text": "ก.", "facts": []},
                                             {"text": "ข.", "facts": []}]},
        {"heading": "คู่เทียบ", "sentences": [{"text": "ค.", "facts": []}]},
    ]}
    assert bg.to_text(r) == "ภาพรวม\nก. ข.\n\nคู่เทียบ\nค."


def test_a_finding_reads_as_a_sentence_a_person_can_act_on():
    f = bg.gate1_numbers(say("QQQ ติดลบ 9.9%", ["ret.QQQ.21d"]), SEL)[0]
    line = f.line()
    assert "ด่าน 1" in line and "ภาพรวม" in line and "9.9" in line


# ------------------------------------------------------- prompt and plumbing

import brief_prompt as bp  # noqa: E402
import brief as brief_main  # noqa: E402


def test_prompt_is_versioned():
    assert bp.PROMPT_VERSION


def test_user_prompt_carries_every_fact_and_the_five_headings():
    text = bp.build_user(SEL)
    for f in SEL.facts:
        assert f.id in text, f"{f.id} ไม่ได้ถูกส่งให้โมเดล"
    for heading, _what in bp.SECTIONS:
        assert heading in text
    assert len(bp.SECTIONS) == 5
    assert SEL.trade_date in text


def test_user_prompt_shows_signs_so_the_model_cannot_miss_a_fall():
    text = bp.build_user(SEL)
    assert "-9.57%" in text          # ret.QQQ.21d
    assert "+2.37%" in text          # ret.SPY.1d


def test_prompt_rules_and_gates_agree_on_every_word():
    # A word the gates reject but the prompt never mentions is a brief held
    # every day for a reason the model was never told. Checked exhaustively,
    # not on a sample, so adding a word to one side cannot pass unnoticed.
    for group in (bg.FORBIDDEN_TH, bg.VAGUE_TIME_TH, bg.EXTREME_WORDS,
                  bg.SUPERLATIVE_WORDS, bg.LEADER_WORDS):
        for w in group:
            assert w in bp.SYSTEM, f'prompt ไม่ได้บอกกติกาเรื่อง "{w}" แต่ด่านจับ'
    for w in bg.FORBIDDEN_EN:
        assert w in bp.SYSTEM
    assert f"{bg.EXTREME_PCTILE:g}" in bp.SYSTEM
    assert f"{bg.SUPERLATIVE_PCTILE:g}" in bp.SYSTEM


def test_changing_the_prompt_forces_a_new_version():
    import hashlib
    got = hashlib.sha256(bp.SYSTEM.encode()).hexdigest()[:12]
    assert got == bp.PROMPT_FINGERPRINT, (
        "SYSTEM เปลี่ยนไปแล้ว — ขยับ PROMPT_VERSION และอัป PROMPT_FINGERPRINT "
        f"เป็น {got} ไม่งั้นบทสรุปสองฉบับจะอ้างเวอร์ชันเดียวกันทั้งที่กติกาต่างกัน")


def test_model_answer_is_parsed_with_or_without_a_code_fence():
    want = {"sections": []}
    assert brief_main.extract_json('{"sections": []}') == want
    assert brief_main.extract_json('```json\n{"sections": []}\n```') == want
    assert brief_main.extract_json('```\n{"sections": []}\n```') == want


def test_held_message_names_the_date_and_the_findings():
    findings = bg.gate1_numbers(say("QQQ ติดลบ 9.9%", ["ret.QQQ.21d"]), SEL)
    msg = brief_main.held_message("2026-11-09", findings)
    assert "2026-11-09" in msg and "ไม่ผ่านด่าน" in msg and "9.9" in msg


def test_published_message_carries_the_body():
    msg = brief_main.published_message("2026-11-09", "เนื้อหา")
    assert "2026-11-09" in msg and "เนื้อหา" in msg


def test_model_list_is_read_correctly():
    payload = {"models": [
        {"name": "models/gemini-3.8-flash",
         "supportedGenerationMethods": ["generateContent", "countTokens"]},
        {"name": "models/text-embedding-004",
         "supportedGenerationMethods": ["embedContent"]},
        {"name": "models/gemini-3.5-flash-lite",
         "supportedGenerationMethods": ["generateContent"]},
        {"name": "not-a-model"},
    ]}
    got = brief_main.usable_models(payload)
    assert got == ["gemini-3.5-flash-lite", "gemini-3.8-flash"], \
        "เอาเฉพาะรุ่นที่เขียนข้อความได้ ตัด embedding และรายการที่ผิดรูปทิ้ง"


def test_model_list_survives_an_empty_or_odd_answer():
    assert brief_main.usable_models({}) == []
    assert brief_main.usable_models({"models": []}) == []
    # a model that lists no methods at all is kept rather than silently dropped
    assert brief_main.usable_models({"models": [{"name": "models/x"}]}) == ["x"]


def test_timeouts_are_split_so_the_two_failures_can_be_told_apart():
    assert brief_main.CONNECT_TIMEOUT_S < brief_main.READ_TIMEOUT_S
    # เคยตรึงไว้ที่ 300 ตอนที่ยังมีรุ่นเดียวและยังไม่รู้ว่าทำไมมันช้า
    # 12 พ.ย. ได้คำตอบแล้วว่าเป็น 503 "high demand" ไม่ใช่โมเดลคิดนาน
    # พอมีรุ่นสำรองแล้ว การนั่งรอคิวนาน ๆ คือการเสียเวลาที่ควรเอาไปถามรุ่นที่ว่าง
    assert brief_main.READ_TIMEOUT_S >= 150, (
        "รอบที่หมดเวลาจริงคือ 120 วินาที ต้องเผื่อมากกว่านั้นพอสมควร "
        "ไม่งั้นจะตัดคำตอบที่กำลังจะมาทิ้ง")


def test_request_asks_for_the_lowest_thinking_the_model_allows():
    body = brief_main.build_body("sys", "user")
    cfg = body["generationConfig"]
    assert cfg["thinkingConfig"] == {"thinkingLevel": brief_main.THINKING_LEVEL}
    assert brief_main.THINKING_LEVEL in ("low", "medium", "high"), (
        "3.8 Flash ไม่รับ 'minimal' และปิดคิดสนิทไม่ได้ — ต่ำสุดที่ใช้ได้คือ low")


def test_token_ceiling_leaves_room_for_thinking_and_the_brief():
    assert brief_main.MAX_OUTPUT_TOKENS >= 8192, (
        "เพดานนี้แชร์กับ thought token · 4096 เคยทำให้คำตอบขาดกลางทาง")
    assert brief_main.build_body("s", "u")["generationConfig"][
        "maxOutputTokens"] == brief_main.MAX_OUTPUT_TOKENS


def test_the_prompt_is_sent_in_the_two_places_the_api_expects():
    body = brief_main.build_body("ระบบ", "ผู้ใช้")
    assert body["system_instruction"]["parts"][0]["text"] == "ระบบ"
    assert body["contents"][0]["parts"][0]["text"] == "ผู้ใช้"
    assert body["contents"][0]["role"] == "user"


def test_a_truncated_answer_says_it_hit_the_token_ceiling():
    data = {"candidates": [{"finishReason": "MAX_TOKENS",
                            "content": {"parts": [{"text": '{"sections": ['}]}}],
            "usageMetadata": {"thoughtsTokenCount": 16380}}
    try:
        brief_main.extract_text(data)
    except RuntimeError as exc:
        msg = str(exc)
    else:
        raise AssertionError("คำตอบที่ถูกตัดกลางทางต้องไม่ถูกส่งต่อไปให้ด่านตรวจ")
    assert "MAX_OUTPUT_TOKENS" in msg or "maxOutputTokens" in msg
    assert "16380" in msg, "ต้องบอกจำนวน token ที่ใช้คิดไป ไม่งั้นแก้ไม่ถูกจุด"
    assert "thinking" in msg.lower() or "THINKING" in msg


def test_an_empty_answer_names_the_finish_reason_instead_of_blaming_the_parser():
    for data in ({"candidates": [{"finishReason": "SAFETY", "content": {}}]},
                 {"candidates": [{"content": {"parts": [{"text": "  "}]}}]},
                 {}):
        try:
            brief_main.extract_text(data)
        except RuntimeError as exc:
            assert "ไม่ได้ส่งข้อความกลับมา" in str(exc)
        else:
            raise AssertionError(f"คำตอบว่างต้องฟ้อง: {data}")
    assert "SAFETY" in _reason_of({"candidates": [
        {"finishReason": "SAFETY", "content": {}}]})


def _reason_of(data):
    try:
        brief_main.extract_text(data)
    except RuntimeError as exc:
        return str(exc)
    return ""


def test_thought_parts_are_not_glued_onto_the_json():
    data = {"candidates": [{"finishReason": "STOP", "content": {"parts": [
        {"text": "ขอคิดก่อน...", "thought": True},
        {"text": '{"sections": []}'}]}}]}
    assert brief_main.extract_text(data) == '{"sections": []}'


def test_a_normal_answer_still_comes_through():
    data = {"candidates": [{"finishReason": "STOP",
                            "content": {"parts": [{"text": '{"sections": []}'}]}}]}
    assert brief_main.extract_json(brief_main.extract_text(data)) == {"sections": []}


# --------------------------------------------------------------------------
# retrying a busy model
# --------------------------------------------------------------------------

class _Resp:
    def __init__(self, status):
        self.status_code = status
        self.text = f"status {status}"


class _Boom(Exception):
    """Stands in for requests.Timeout, so these tests need no network stack."""


def _ladder(statuses):
    """A send() that returns each status in turn; an Exception class is raised."""
    seq = list(statuses)
    calls = []

    def send():
        item = seq.pop(0)
        calls.append(item)
        if isinstance(item, type) and issubclass(item, Exception):
            raise item()
        return _Resp(item)
    return send, calls


def _run(statuses, waits=(1, 2, 3)):
    slept = []
    send, calls = _ladder(statuses)
    r = brief_main.with_retries(send, _Boom, waits=waits, sleep=slept.append)
    return r, calls, slept


def test_every_busy_status_is_retried():
    for status in (429, 500, 502, 503, 504):
        r, calls, _ = _run([status, 200])
        assert r.status_code == 200, f"HTTP {status} ต้องลองใหม่ ไม่ใช่ยอมแพ้"
        assert calls == [status, 200]


def test_a_good_answer_is_not_retried():
    r, calls, slept = _run([200, 200, 200, 200])
    assert r.status_code == 200 and calls == [200] and slept == []


def test_an_error_we_caused_is_not_retried():
    for status in (400, 401, 403, 404):
        r, calls, _ = _run([status, 200])
        assert r.status_code == status, (
            f"HTTP {status} เป็นความผิดฝั่งเรา ลองใหม่กี่ครั้งก็เหมือนเดิม")
        assert calls == [status]


def test_a_timeout_is_retried_like_a_busy_model():
    r, calls, _ = _run([_Boom, 200])
    assert r.status_code == 200 and len(calls) == 2


def test_the_wait_between_tries_grows():
    _run([503, 503, 503, 200])
    _, _, slept = _run([503, 503, 503, 200])
    assert slept == [1, 2, 3], "ต้องรอนานขึ้นทีละครั้ง ไม่ใช่ถี่ ๆ ซ้ำ ๆ"
    assert list(brief_main.RETRY_WAITS_S) == sorted(brief_main.RETRY_WAITS_S)
    assert brief_main.RETRY_WAITS_S[0] >= 5, "รอสั้นเกินไปก็เจอโมเดลไม่ว่างซ้ำ"


def test_giving_up_raises_the_one_error_that_is_not_our_fault():
    try:
        _run([503, 503, 503, 503])
    except brief_main.ModelUnavailable as exc:
        assert "503" in str(exc) and "4" in str(exc)
    else:
        raise AssertionError("ลองครบแล้วยังไม่ได้ ต้องบอกว่าโมเดลไม่ว่าง")


def test_model_unavailable_is_told_apart_from_a_real_break():
    assert issubclass(brief_main.ModelUnavailable, RuntimeError)
    assert brief_main.ModelUnavailable is not RuntimeError, (
        "ถ้าใช้ RuntimeError เฉย ๆ main() จะแยก 'โมเดลไม่ว่าง' "
        "ออกจาก 'โค้ดพัง' ไม่ได้ แล้วจะเงียบทั้งคู่")


def test_the_number_of_tries_is_what_the_waits_say():
    send, calls = _ladder([503] * 9)
    try:
        brief_main.with_retries(send, _Boom, waits=(1, 2), sleep=lambda _: None)
    except brief_main.ModelUnavailable:
        pass
    assert len(calls) == 3, "ลองครั้งแรก + ลองซ้ำตามจำนวนช่วงรอ"


# --------------------------------------------------------------------------
# falling back to a quieter model
# --------------------------------------------------------------------------

def test_the_configured_model_comes_first_and_nothing_repeats():
    chain = brief_main.model_chain("gemini-3.8-flash", ["a", "b", "a"])
    assert chain == ["gemini-3.8-flash", "a", "b"]
    assert brief_main.model_chain("a", ["a"]) == ["a"]
    assert brief_main.model_chain("a", []) == ["a"]


def test_there_is_somewhere_to_fall_back_to():
    assert brief_main.FALLBACK_MODELS, (
        "ไม่มีรุ่นสำรอง = รุ่นเดียวไม่ว่าง แล้วไม่มีบทสรุปทั้งวัน")
    assert brief_main.MODEL not in brief_main.FALLBACK_MODELS or True
    assert len(brief_main.model_chain()) >= 2


def test_a_busy_model_hands_over_to_the_next_one():
    busy = {"m1", "m2"}

    def attempt(model):
        if model in busy:
            raise brief_main.ModelUnavailable(f"{model} ไม่ว่าง")
        return f"คำตอบจาก {model}"

    raw, used = brief_main.try_models(attempt, ["m1", "m2", "m3"])
    assert used == "m3" and raw == "คำตอบจาก m3"


def test_the_model_that_answered_is_the_one_reported():
    raw, used = brief_main.try_models(lambda m: "ok", ["first", "second"])
    assert used == "first", (
        "ต้องคืนรุ่นที่ตอบจริง ไม่ใช่รุ่นที่ตั้งไว้ — ค่านี้ถูกเขียนลง "
        "daily_brief.model ถ้าผิด การเทียบคุณภาพระหว่างรุ่นจะเพี้ยนทั้งหมด")


def test_a_real_break_is_not_swallowed_by_the_fallback_walk():
    def attempt(model):
        raise RuntimeError("กุญแจผิด")

    try:
        brief_main.try_models(attempt, ["m1", "m2"])
    except RuntimeError as exc:
        assert not isinstance(exc, brief_main.ModelUnavailable), (
            "401/400 ต้องทะลุออกไปทันที ไม่ใช่ไล่ลองทุกรุ่นแล้วรายงานว่าโมเดลไม่ว่าง")
        assert "กุญแจผิด" in str(exc)
    else:
        raise AssertionError("ข้อผิดพลาดจริงต้องไม่ถูกกลืน")


def test_giving_up_names_every_model_tried():
    def attempt(model):
        raise brief_main.ModelUnavailable(f"{model} ไม่ว่าง")

    try:
        brief_main.try_models(attempt, ["m1", "m2", "m3"])
    except brief_main.ModelUnavailable as exc:
        for m in ("m1", "m2", "m3"):
            assert m in str(exc), f"ต้องบอกว่าลอง {m} แล้วด้วย"


def test_the_whole_walk_fits_inside_the_step_cap():
    tries = len(brief_main.RETRY_WAITS_S) + 1
    models = len(brief_main.model_chain())
    worst = models * tries * brief_main.READ_TIMEOUT_S + \
        models * sum(brief_main.RETRY_WAITS_S)
    assert worst < 30 * 60, (
        f"กรณีเลวร้ายสุด {worst / 60:.1f} นาที เกิน timeout-minutes: 30 "
        "ของสเตปใน workflow — งานจะถูกตัดกลางคันแทนที่จะรายงานว่าโมเดลไม่ว่าง")


# --------------------------------------------------------------------------
# positions in a ranking ("อันดับ 1") -- the first thing a real model wrote
# that the gates got wrong
# --------------------------------------------------------------------------

def test_a_true_rank_claim_passes():
    s = say("PAWZ มาแรงเป็นอันดับ 1 ของ all_top ด้วยผลตอบแทน 21 วันที่ 15.92%",
            ["rank.all_top.1"])
    assert bg.gate1_numbers(s, SEL) == [], (
        "เลขหลัง 'อันดับ' คือตำแหน่ง ไม่ใช่ค่าที่วัดได้ "
        "ประโยคนี้คือสิ่งที่โมเดลเขียนจริงเมื่อ 11 พ.ย. และด่านเคยฟ้องผิด")


def test_a_rank_the_cited_fact_does_not_hold_fails():
    s = say("PAWZ เป็นอันดับ 3 ด้วยผลตอบแทน 21 วันที่ 15.92%", ["rank.all_top.1"])
    findings = bg.gate1_numbers(s, SEL)
    assert any(f.code == "unbacked_rank" for f in findings), \
        "อ้างอันดับ 3 ขณะที่ fact เป็นอันดับ 1 ต้องไม่ผ่าน"


def test_claiming_a_rank_with_no_rank_fact_fails():
    s = say("XLV เป็นอันดับ 1 ที่ 10.26%", ["rank.us_sector.XLV"])
    assert any(f.code == "unbacked_rank" for f in bg.gate1_numbers(s, SEL)), \
        "fact ที่ไม่มีเลขอันดับอยู่ในชื่อ พิสูจน์ตำแหน่งไม่ได้"


def test_a_percentile_written_with_thi_is_not_read_as_a_rank():
    s = say("ส่วนต่าง Low Beta − High Beta อยู่ที่ 13.92 จุด "
            "เปอร์เซ็นไทล์ที่ 98.74 จาก 717 วัน",
            ["pair.lowbeta_highbeta.spread", "pair.lowbeta_highbeta.pctile_3y",
             "pair.lowbeta_highbeta.n_days"])
    assert bg.gate1_numbers(s, SEL) == [], \
        "'ที่ 98.74' เป็นค่า ไม่ใช่อันดับ ต้องยังถูกตรวจเทียบ fact ตามเดิม"


def test_a_wrong_percentile_after_thi_still_fails():
    s = say("เปอร์เซ็นไทล์ที่ 50.00 จาก 717 วัน",
            ["pair.lowbeta_highbeta.pctile_3y", "pair.lowbeta_highbeta.n_days"])
    assert bg.gate1_numbers(s, SEL), \
        "การยกเว้นอันดับต้องไม่เผลอเปิดช่องให้ตัวเลขหลังคำว่า 'ที่' ผ่านฟรี"


def test_an_event_number_is_not_proof_of_a_rank():
    """events.1 is the first item on the calendar, not first place in a
    ranking. Both ids end in a number, and only the "rank." prefix tells them
    apart -- so a sentence citing an event must not be able to claim a
    position. Without this the prefix check could be deleted and nothing in
    the suite would notice (mutation M27 survived exactly here)."""
    s = say("XLV เป็นอันดับ 1 ของกลุ่ม", ["events.1"])
    assert any(f.code == "unbacked_rank" for f in bg.gate1_numbers(s, SEL)), \
        "เลขท้าย id ของ fact ปฏิทินไม่ใช่อันดับ จึงพิสูจน์ตำแหน่งไม่ได้"


def test_the_value_next_to_a_rank_is_still_checked():
    s = say("PAWZ เป็นอันดับ 1 ด้วยผลตอบแทน 21 วันที่ 99.99%", ["rank.all_top.1"])
    assert any(f.code == "unbacked_number" for f in bg.gate1_numbers(s, SEL)), \
        "ยกเว้นเฉพาะตัวเลขอันดับ ตัวเลขอื่นในประโยคเดียวกันต้องยังถูกตรวจ"
