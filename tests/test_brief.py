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


def sheet(trade_date: str = "2026-11-09", version: str = "v2") -> dict:
    """แผ่น v2 · ส่ง version="v1" เพื่อทดสอบแผ่นเก่าที่ถูกแช่แข็งไว้แล้ว

    กลุ่มรายสัปดาห์กับฤดูกาลเพิ่มเข้ามาในรอบ B2a แผ่นที่สร้างก่อนหน้านั้น
    ไม่มีและจะไม่มีวันมี เพราะ daily_facts แช่แข็งเมื่อสร้างแล้ว
    """
    s = {
        "meta": {"trade_date": trade_date, "universe_n": 93,
                 "facts_version": version,
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
            # รอบ B2b-1: บทสรุปเริ่มอ่าน risk · รูปร่างตรงกับแผ่นจริงของ 13 พ.ย.
            # (keys สี่ตัว · values เป็นแถวตามลำดับ keys) ค่าปัดจากของจริง
            "risk": {
                "available": True, "unit": "pct", "source": "risk_metrics(active)",
                "keys": ["atr_pct", "atr_pctile_1y", "pos_52w", "pct_from_high"],
                "values": {
                    "SPY": [1.69, 100, 82.48, -3.49],
                    "QQQ": [2.74, 98.41, 60.20, -10.88],
                    "DBC": [1.72, 61.90, 73.20, -9.81],
                    "PAWZ": [1.71, 98.02, 87.47, -2.50],
                    # ไม่ใช่ asset class และไม่ได้อยู่ห้าอันดับแรก ต้องไม่ถูกส่ง
                    "XLK": [3.68, 98.81, 57.11, -16.22],
                },
            },
            # groups the brief does not use -- present so the fixture matches reality
            "health": {"available": True, "health": {}},
            "macro": {"items": []},
            "vol.day": {"keys": ["z", "rvol"], "values": {}},
        },
    }
    if version == "v1":
        return s

    # ---- กลุ่มที่เพิ่มในรอบ B2a ------------------------------------------
    s["groups"]["ret.week"] = {
        "unit": "pct", "keys": [1, 4, 13],
        "source": "trailing_returns(active,'week',[1,4,13])",
        # trade_date ของฟิกซ์เจอร์คือจันทร์ 9 พ.ย. สัปดาห์ที่ปิดแล้วจึงเริ่ม 2 พ.ย.
        "week_start": "2026-11-02", "days_in_week": 5,
        "values": {
            "SPY": [1.85, -2.10, 3.40], "QQQ": [2.40, -6.80, -1.20],
            "IWM": [1.10, 0.90, 4.50], "EFA": [0.70, 1.80, 6.20],
            "EEM": [0.95, 2.40, 8.10], "IEF": [0.05, 0.30, 0.90],
            "VNQ": [0.45, 1.20, 2.80], "DBC": [-0.80, -2.60, -4.10],
        },
    }
    s["groups"]["vol.week"] = {
        "keys": ["z", "rvol"], "baseline_weeks": 20,
        "values": {
            "PAWZ": [1.42, 1.65], "AGNG": [0.35, 1.08], "FIW": [2.10, 2.43],
            "PHO": [-0.20, 0.95], "INDA": [0.80, 1.22],
            # กองที่ไม่ได้อยู่ห้าอันดับแรก ต้องไม่ถูกส่งเข้า prompt
            "XLK": [3.00, 3.10],
        },
    }
    # ลำดับในนี้ตั้งใจไม่เหมือน ASSET_CLASS_FALLBACK เพื่อพิสูจน์ว่าโค้ด
    # อ่านรายชื่อจากแผ่นจริง ไม่ได้อ่านจากค่าคงที่ในไฟล์
    s["groups"]["rank"]["asset_class_ranked"] = [
        ["EEM", 3.1], ["EFA", 2.0], ["VNQ", 1.7], ["IEF", 0.4],
        ["DBC", -3.0], ["SPY", -3.32404339229001]]
    s["groups"]["rank"]["broad_market_ranked"] = [
        ["EEM", 3.1], ["EFA", 2.0], ["VNQ", 1.7], ["IWM", 1.28], ["IEF", 0.4]]
    s["groups"]["seasonal"] = {
        "ticker": "SPY", "min_n": 8,
        # period เป็นจำนวนเต็มตามแผ่นจริง (extract(week) / extract(month))
        # ไม่ใช่ข้อความ — ฟิกซ์เจอร์เคยเขียนเป็น "สัปดาห์ที่ 46" และ "ธันวาคม"
        # ซึ่งไม่ตรงกับของจริง (พบ 15 พ.ย. 2026)
        "week_current": {"available": True, "period": 46, "n": 10,
                         "win_pct": 60.0, "mean_pct": 0.42},
        "week_next": {"available": True, "period": 47, "n": 10,
                      "win_pct": 70.0, "mean_pct": 0.85},
        "month_next": {"available": True, "period": 12, "n": 20,
                       "win_pct": 65.0, "mean_pct": 1.10},
        "baseline_week": {"n": 150, "win_pct": 58.9, "mean_pct": 0.21},
        "baseline_month": {"n": 35, "win_pct": 62.3, "mean_pct": 0.78},
    }
    return s


def say(text, facts, heading="ภาพรวม"):
    return {"sections": [{"heading": heading,
                          "sentences": [{"text": text, "facts": facts}]}]}


SEL = bf.select_facts(sheet())


# --------------------------------------------------------------- fact picking

def test_universe_is_the_whole_active_list():
    assert len(SEL.universe) == 93
    assert "SPY" in SEL.universe and "NVDA" not in SEL.universe


def test_only_the_two_agreed_timeframes_are_offered():
    """กรอบเวลาที่ส่งให้โมเดล: 1 และ 4 สัปดาห์ จาก retw · 21 วัน จาก ret.day

    รอบ B2a เปลี่ยน 1 วัน เป็น 5 วัน · รอบ B2a.1 ตัด 5 วันออกอีก เพราะ
    บทสรุปออกจากแผ่นของวันศุกร์เสมอ และ 5 วันทำการที่จบวันศุกร์คือสัปดาห์
    นั้นพอดี — เป็นตัวเลขเดียวกันที่ส่งไปสองชื่อ
    """
    ids = {f.id for f in SEL.facts if f.id.startswith(("ret.", "retw."))}
    assert "ret.SPY.21d" in ids
    assert "retw.SPY.1w" in ids and "retw.SPY.4w" in ids
    assert not any(i.endswith(".1d") for i in ids), "1 วันออกไปแล้วในรอบ B2a"
    assert not any(i.endswith(".5d") for i in ids), "5 วันออกไปแล้วในรอบ B2a.1"


def test_values_carry_through_unrounded():
    index = SEL.by_id()
    assert index["ret.QQQ.21d"].value == -9.57312844590638
    assert index["pair.qqq_spy.pctile_3y"].value == 0.916380297823597
    assert index["breadth.today.above"].value == 47


def test_facts_from_groups_the_brief_does_not_use_are_absent():
    ids = {f.id for f in SEL.facts}
    # risk ออกจากรายการนี้ในรอบ B2b-1 (บทสรุปเริ่มอ่าน) · ดู test_risk_* ท้ายไฟล์
    assert not any(i.startswith(("health.", "vol.", "macro.")) for i in ids)


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
    assert sorted(bf.REQUIRED_GROUPS_V1) == sorted(
        ["ret.day", "beta", "rank", "pair", "breadth", "events"])
    assert sorted(bf.REQUIRED_GROUPS_V2) == sorted(
        ["ret.day", "beta", "rank", "pair", "breadth", "events",
         "ret.week", "vol.week", "seasonal"])
    for name in bf.REQUIRED_GROUPS_V2:
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
    assert bg.gate3_language(say("ผู้ซื้อ buyer หลายราย", [])) == []


def test_words_that_assume_the_reading_day_fail():
    f = bg.gate3_language(say("วันนี้ตลาดปรับขึ้น", []))
    assert [x.code for x in f] == ["vague_time"]


def test_volume_words_moved_from_banned_to_conditional_in_b2a():
    """"มาเร็ว" ถูกห้ามใน v1 เพราะไม่มี fact ใดพิสูจน์ได้ · v2 ส่ง vol.week
    เข้า prompt แล้ว คำนี้จึงย้ายจาก "ห้าม" มาเป็น "ต้องมีตัวเลขถึงเกณฑ์"
    """
    assert bg.gate3_language(say("PAWZ มาเร็ว", [])) == []
    assert [x.code for x in bg.gate4_adjectives(say("PAWZ มาเร็ว", []), SEL)] \
        == ["unbacked_adjective"]


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
            {"text": "SPY บวก 1.85% ในสัปดาห์ที่ปิดแล้ว แต่ยังติดลบ 3.32% ในรอบ 21 วัน",
             "facts": ["retw.SPY.1w", "ret.SPY.21d"]}]},
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


def test_user_prompt_carries_every_fact_and_every_heading():
    text = bp.build_user(SEL)
    for f in SEL.facts:
        assert f.id in text, f"{f.id} ไม่ได้ถูกส่งให้โมเดล"
    for heading, _what in bp.SECTIONS:
        assert heading in text
    assert len(bp.SECTIONS) == 7      # รอบ B2b-1 เพิ่ม "ความผันผวนและตำแหน่งราคา"
    assert SEL.trade_date in text


def test_user_prompt_shows_signs_so_the_model_cannot_miss_a_fall():
    text = bp.build_user(SEL)
    assert "-9.57%" in text          # ret.QQQ.21d
    assert "+1.85%" in text          # retw.SPY.1w


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


# ===========================================================================
# รอบ B2a · รายสัปดาห์ ฤดูกาล และกติกาภาษาชุดใหม่
# ===========================================================================

SEL_V1 = bf.select_facts(sheet(version="v1"))


def test_weekly_returns_reach_the_model():
    ids = {f.id for f in SEL.facts}
    assert "retw.SPY.1w" in ids and "retw.SPY.4w" in ids
    # 13 สัปดาห์อยู่ในแผ่นมาตลอด เริ่มส่งเข้า prompt ในรอบ B2b-1
    assert "retw.SPY.13w" in ids
    assert SEL.by_id()["retw.SPY.13w"].value == 3.40
    assert SEL.by_id()["retw.QQQ.4w"].value == -6.80


def test_weekly_volume_is_offered_only_for_the_top_five():
    ids = {f.id for f in SEL.facts if f.id.startswith("volw.")}
    assert "volw.FIW.z" in ids and "volw.FIW.rvol" in ids
    # XLK มีตัวเลขอยู่ในแผ่น แต่ไม่ได้อยู่ห้าอันดับแรก · ตัวเลขที่ส่งไปแต่
    # ไม่ได้ใช้ คือตัวเลขที่โมเดลอาจหยิบมาพูด
    assert not any(i.startswith("volw.XLK") for i in ids)


def test_asset_class_list_comes_from_the_sheet_not_the_constant():
    # แผ่นเรียง EEM มาก่อน SPY ซึ่งต่างจากลำดับในค่าคงที่
    order = [f.ticker for f in SEL.facts if f.id.endswith(".21d")
             and f.id.startswith("ret.")]
    assert order[0] == "EEM", order
    assert bf.ASSET_CLASS_FALLBACK[0] == "SPY"
    # แผ่น v1 ไม่มีอันดับ asset class จึงต้องตกมาที่ค่าคงที่ได้จริง
    order_v1 = [f.ticker for f in SEL_V1.facts if f.id.endswith(".21d")
                and f.id.startswith("ret.")]
    assert order_v1[0] == "SPY", order_v1


def test_seasonal_facts_always_travel_with_their_baseline():
    ids = {f.id for f in SEL.facts}
    for key in ("week_current", "week_next", "month_next"):
        assert f"seasonal.{key}.win_pct" in ids
        assert f"seasonal.{key}.n" in ids
    assert "seasonal_baseline.week.win_pct" in ids
    assert "seasonal_baseline.month.win_pct" in ids


def test_seasonal_windows_that_are_not_available_are_not_offered():
    s = sheet()
    s["groups"]["seasonal"]["month_next"] = {"available": False, "reason": "ไม่ใช่สัปดาห์สุดท้าย"}
    ids = {f.id for f in bf.select_facts(s).facts}
    assert not any(i.startswith("seasonal.month_next") for i in ids)
    assert "seasonal.week_current.win_pct" in ids


def test_required_groups_follow_the_sheets_own_version():
    # แผ่น v1 ถูกแช่แข็งไว้ก่อนกลุ่มใหม่จะมีอยู่ · ถ้าเรียกร้องกลุ่มใหม่
    # จากแผ่นเก่า บทสรุปจะถูกกักทุกวันโดยไม่มีวันผ่าน
    assert bf.missing_groups(sheet(version="v1")) == []
    assert bf.missing_groups(sheet()) == []
    s = sheet()
    del s["groups"]["seasonal"]
    assert bf.missing_groups(s) == ["seasonal"]
    s1 = sheet(version="v1")
    assert "seasonal" not in bf.required_groups(s1)


def test_no_fact_label_leaks_an_internal_code():
    # 11 พ.ย. โมเดลเขียน "อันดับ 1 ของ all_top" ลงในบทสรุป · ต้นตอคือป้ายชื่อ
    # ที่เราเขียนเอง ไม่ใช่โมเดลดื้อ จึงต้องล็อกที่ป้าย
    for f in SEL.facts:
        for code in bg.RAW_CODES:
            assert code not in f.label, f"{f.id} มีรหัส {code} อยู่ในป้ายชื่อ"


def test_universe_ranks_carry_their_position_in_the_id():
    index = SEL.by_id()
    assert index["rank.asset_class.1"].ticker == "EEM"
    assert index["rank.asset_class.6"].ticker == "SPY"
    assert index["rank.broad_market.4"].ticker == "IWM"
    # ด่าน 1 ต้องตรวจคำว่า "อันดับ N" จาก id ได้ เหมือน rank.*_top.*
    assert bg.gate1_numbers(
        say("EEM อยู่อันดับ 1 ในกลุ่มประเภทสินทรัพย์ ที่บวก 3.10%",
            ["rank.asset_class.1"]), SEL) == []
    # อ้างอันดับ 3 แต่ fact ที่อ้างคืออันดับ 1 — ด่าน 1 จับได้จาก id
    assert [x.code for x in bg.gate1_numbers(
        say("EEM อยู่อันดับ 3 ในกลุ่มประเภทสินทรัพย์ ที่บวก 3.10%",
            ["rank.asset_class.1"]), SEL)] == ["unbacked_rank"]


def test_proportions_are_not_printed_with_a_plus_sign():
    # "+46.24%" ชวนให้อ่านว่าเพิ่มขึ้น 46% ซึ่งไม่ใช่สิ่งที่ค่านี้บอก
    assert bp._fmt(50.5376344086022, "pct_level") == "50.54%"
    assert bp._fmt(2.36, "pct") == "+2.36%"
    assert bp._fmt(1.42, "sigma") == "+1.42 ส่วนเบี่ยงเบน"
    assert bp._fmt(1.65, "times") == "1.65 เท่า"
    text = bp.build_user(SEL)
    assert "50.54%" in text and "+50.54%" not in text


def test_breadth_label_stops_inviting_a_word_gate3_bans():
    labels = [f.label for f in SEL.facts if f.id.startswith("breadth.today")]
    assert labels
    for lab in labels:
        for w in bg.VAGUE_TIME_TH:
            assert w not in lab, f"ป้าย {lab} ชวนให้โมเดลเขียนคำที่ด่าน 3 ห้าม"


# ------------------------------------------------------------- ด่าน 3 ชุดใหม่

def test_gate3_refuses_money_flow_language():
    for w in ("เงินทุนไหลเข้า IEF", "เม็ดเงินย้ายออก", "เข้าหลุมหลบภัย",
              "เป็นสินทรัพย์ปลอดภัย"):
        f = bg.gate3_language(say(w, []))
        # ประโยคหนึ่งอาจชนคำห้ามมากกว่าหนึ่งคำ ("เงินทุนไหล" + "ไหลเข้า")
        assert f and all(x.code == "advice" for x in f), w


def test_gate3_refuses_bucket_labels_we_never_computed():
    for w in ("กลุ่มตั้งรับนำตลาด", "หุ้นวัฏจักรตามหลัง", "เชิงรุกแพ้เชิงรับ"):
        assert any(x.code == "advice" for x in bg.gate3_language(say(w, []))), w


def test_gate3_refuses_actors_the_sheet_cannot_see():
    for w in ("นักลงทุนสถาบันขาย", "รายย่อยเข้าซื้อ", "ต่างชาติขายสุทธิ"):
        assert any(x.code == "advice" for x in bg.gate3_language(say(w, []))), w


def test_gate3_refuses_intensifiers_with_no_threshold():
    for w in ("ลดลงอย่างมีนัยสำคัญ", "สูงขึ้นอย่างมาก", "แนวโน้มชัดเจน"):
        assert any(x.code == "advice" for x in bg.gate3_language(say(w, []))), w


def test_gate3_refuses_raw_fact_codes_in_the_prose():
    f = bg.gate3_language(say("PAWZ อยู่อันดับ 1 ของ all_top", ["rank.all_top.1"]))
    assert [x.code for x in f] == ["raw_code"]
    assert "all_top" in f[0].detail
    assert bg.gate3_language(
        say("PAWZ อยู่อันดับ 1 สูงสุดของทั้งลิสต์", ["rank.all_top.1"])) == []


def test_gate3_caps_the_length_of_the_whole_brief():
    long_text = "ก" * (bg.BODY_MAX_CHARS + 1)
    f = bg.gate3_language(say(long_text, []))
    assert [x.code for x in f] == ["too_long"]
    assert bg.gate3_language(say("ก" * 100, [])) == []


# ------------------------------------------------------------- ด่าน 4 ชุดใหม่

def test_wide_words_need_a_percentile_but_a_lower_one_than_extreme():
    ok = say("ส่วนต่าง Low Beta − High Beta ขาดลอยที่เปอร์เซ็นไทล์ 98.74",
             ["pair.lowbeta_highbeta.pctile_3y"])
    assert bg.gate4_adjectives(ok, SEL) == []
    bad = say("QQQ − SPY ทิ้งห่างที่เปอร์เซ็นไทล์ 0.92 จุด",
              ["pair.iwm_spy.spread"])
    assert [x.code for x in bg.gate4_adjectives(bad, SEL)] == ["unbacked_adjective"]


def test_volume_words_need_a_weekly_volume_fact_that_reaches_the_bar():
    assert bg.gate4_adjectives(
        say("FIW ปริมาณซื้อขายเร่งขึ้น 2.43 เท่าของฐาน", ["volw.FIW.rvol"]), SEL) == []
    assert bg.gate4_adjectives(
        say("PAWZ ปริมาณซื้อขายคึกคัก ที่ 1.42 ส่วนเบี่ยงเบน", ["volw.PAWZ.z"]), SEL) == []
    # AGNG อยู่ใต้เกณฑ์ทั้งสองทาง
    assert [x.code for x in bg.gate4_adjectives(
        say("AGNG ปริมาณซื้อขายเร่งขึ้น", ["volw.AGNG.z", "volw.AGNG.rvol"]), SEL)] \
        == ["unbacked_adjective"]


def test_fragile_words_need_both_the_level_and_the_direction():
    s = sheet()
    s["groups"]["breadth"]["today"]["pct"] = 46.2366
    s["groups"]["breadth"]["today"]["above"] = 43
    sel = bf.select_facts(s)
    ok = say("ความกว้างของตลาดไม่ทั่วถึง อยู่ที่ 46.24% จาก 54.84% เมื่อ 21 วันก่อน",
             ["breadth.today.pct", "breadth.prior_21d.pct"])
    assert bg.gate4_adjectives(ok, sel) == []
    # อ้างค่าเดียว: ไม่มีทิศทาง
    one = say("ความกว้างของตลาดเปราะบางที่ 46.24%", ["breadth.today.pct"])
    assert [x.code for x in bg.gate4_adjectives(one, sel)] == ["unbacked_adjective"]
    # เหนือครึ่ง: ระดับไม่ถึงเกณฑ์ แม้จะลดลงจริง
    above = say("ความกว้างของตลาดอ่อนแอลง จาก 54.84% มาที่ 50.54%",
                ["breadth.today.pct", "breadth.prior_21d.pct"])
    assert [x.code for x in bg.gate4_adjectives(above, SEL)] == ["unbacked_adjective"]
    # ต่ำกว่าครึ่งแต่กำลังดีขึ้น: ระดับผ่าน ทิศทางไม่ผ่าน · ถ้าไม่มีกรณีนี้
    # การลบเงื่อนไขทิศทางออกจะไม่ทำให้ชุดเทสต์แดง (M35)
    s2 = sheet()
    s2["groups"]["breadth"]["today"]["pct"] = 46.2366
    s2["groups"]["breadth"]["prior_21d"]["pct"] = 40.0
    sel2 = bf.select_facts(s2)
    rising = say("ความกว้างของตลาดอ่อนแอลง อยู่ที่ 46.24% จาก 40.00% เมื่อ 21 วันก่อน",
                 ["breadth.today.pct", "breadth.prior_21d.pct"])
    assert [x.code for x in bg.gate4_adjectives(rising, sel2)] == ["unbacked_adjective"]


def test_diverge_words_need_two_numbers_that_really_point_apart():
    ok = say("IEF บวก 0.40% สวนทาง DBC ที่ติดลบ 3.00%",
             ["ret.IEF.21d", "ret.DBC.21d"])
    assert bg.gate4_adjectives(ok, SEL) == []
    bad = say("EFA บวก 2.00% สวนทาง EEM ที่บวก 3.10%",
              ["ret.EFA.21d", "ret.EEM.21d"])
    assert [x.code for x in bg.gate4_adjectives(bad, SEL)] == ["unbacked_adjective"]


# ------------------------------------------------------------------- ด่าน 5

def test_gate5_holds_a_seasonal_claim_that_has_no_baseline():
    bad = say("สัปดาห์ที่ 46 ในอดีตปิดบวก 60.00% ของ 10 ครั้ง",
              ["seasonal.week_current.win_pct", "seasonal.week_current.n"])
    f = bg.gate5_seasonal(bad, SEL)
    assert [x.code for x in f] == ["seasonal_no_baseline"]
    assert f[0].gate == 5


def test_gate5_passes_when_the_baseline_sits_in_the_same_sentence():
    ok = say("สัปดาห์ที่ 46 ในอดีตปิดบวก 60.00% ของ 10 ครั้ง เทียบค่าปกติทุกสัปดาห์ที่ 58.90%",
             ["seasonal.week_current.win_pct", "seasonal.week_current.n",
              "seasonal_baseline.week.win_pct"])
    assert bg.gate5_seasonal(ok, SEL) == []


def test_gate5_asks_for_the_monthly_baseline_for_a_monthly_claim():
    # ฐานรายสัปดาห์ไม่ใช่ฐานของงวดรายเดือน
    wrong = say("ธันวาคมในอดีตปิดบวก 65.00% เทียบค่าปกติทุกสัปดาห์ที่ 58.90%",
                ["seasonal.month_next.win_pct", "seasonal_baseline.week.win_pct"])
    assert [x.code for x in bg.gate5_seasonal(wrong, SEL)] == ["seasonal_no_baseline"]
    right = say("ธันวาคมในอดีตปิดบวก 65.00% เทียบค่าปกติทุกเดือนที่ 62.30%",
                ["seasonal.month_next.win_pct", "seasonal_baseline.month.win_pct"])
    assert bg.gate5_seasonal(right, SEL) == []


def test_validate_runs_gate5_too():
    bad = say("สัปดาห์ที่ 46 ในอดีตปิดบวก 60.00%", ["seasonal.week_current.win_pct"],
              heading="สถิติฤดูกาล")
    assert any(x.gate == 5 for x in bg.validate(bad, SEL))


# ------------------------------------------------- เงื่อนไขรอบเขียนรายสัปดาห์

def test_weekly_condition_needs_the_weekend_and_this_weeks_data():
    from datetime import datetime, timezone

    def at(y, m, d, h=4):
        return datetime(y, m, d, h, 0, tzinfo=timezone.utc)

    # ศุกร์ 13 พ.ย. 2026 เป็นสัปดาห์ ISO ที่ 46 · เสาร์ 14 พ.ย. ก็สัปดาห์ 46
    ok, why = brief_main.should_write_weekly("2026-11-13", at(2026, 11, 14))
    assert ok and why == ""
    ok, why = brief_main.should_write_weekly("2026-11-13", at(2026, 11, 15))
    assert ok, "อาทิตย์ก็ยังอยู่ในสัปดาห์เดียวกันตามปฏิทิน ISO"
    # กลางสัปดาห์: ข้อมูลอยู่สัปดาห์เดียวกันแต่สัปดาห์ยังไม่จบ
    ok, why = brief_main.should_write_weekly("2026-11-11", at(2026, 11, 11))
    assert not ok and "เสาร์" in why
    # เสาร์ที่ข้อมูลของสัปดาห์นี้ยังไม่มา (ศุกร์ราคาไม่ครบ ด่านความครบกัน)
    ok, why = brief_main.should_write_weekly("2026-11-06", at(2026, 11, 14))
    assert not ok and "สัปดาห์นี้ยังไม่มา" in why


def test_a_refusal_by_design_is_not_a_failed_job():
    # ด่านความครบของรอบ B1 ทำงานถูกต้องเมื่อมันปฏิเสธ · ถ้างานแดง
    # ไฟแดงที่ถูกต้องกับไฟแดงที่เป็นบั๊กจะหน้าตาเหมือนกันทุกวัน
    assert brief_main.refusal_is_by_design("ข้อมูลไม่ครบ · ราคา 15/93 — ยังไม่สร้างแผ่น")
    assert brief_main.refusal_is_by_design("ยังไม่ถึงเวลา — สร้างได้ตั้งแต่ ...")
    assert not brief_main.refusal_is_by_design("ไม่มีข้อมูลราคาเลย")
    assert not brief_main.refusal_is_by_design("")


def test_the_duplicate_five_day_timeframe_is_gone():
    """13 พ.ย. 2026 ของจริง: SPY ret.day 5 วัน = 2.5948969331844 และ
    ret.week 1 สัปดาห์ = 2.5948969331844 — เท่ากันทุกหลัก

    บทสรุปออกจากแผ่นของวันศุกร์เสมอ (มติ 17) จึงเป็นวันที่สองค่านี้ตรงกัน
    เสมอ · ผลของการส่งทั้งคู่: บรีฟทดลองฉบับแรกเรียกสัปดาห์ว่า "5 วันทำการ"
    ทั้งหัวข้อ และคำว่าสัปดาห์ไม่ปรากฏในหัวข้อ "ภาพรวม" เลย
    """
    assert bf.RET_LOOKBACKS == [21]
    ids = {f.id for f in SEL.facts}
    assert not any(i.startswith("ret.") and i.endswith("d") and "21d" not in i
                   for i in ids)
    # และของที่เหลือต้องเรียกตัวเองว่าสัปดาห์จริง ๆ
    w = SEL.by_id()["retw.SPY.1w"].label
    assert "สัปดาห์" in w and "วันทำการ" not in w


# ===========================================================================
# รอบ B2a.1 · คำบอกเวลาระดับสัปดาห์
# ===========================================================================

# คำที่อ้างอิงเวลาของผู้อ่าน ไม่ใช่เวลาของข้อมูล · ป้ายชื่อ fact ห้ามมีคำพวกนี้
# เพราะ prompt คือที่มาของภาษาที่หลุดออกไปถึงคนอ่าน (บทเรียนข้อ 10)
READER_RELATIVE_WORDS = ["วันนี้", "สัปดาห์นี้", "สัปดาห์ปัจจุบัน", "เดือนนี้",
                         "ตอนนี้", "ขณะนี้", "เมื่อวาน", "พรุ่งนี้"]


def test_no_fact_label_uses_a_word_that_depends_on_when_it_is_read():
    """ครอบทุกป้ายชื่อ ไม่ใช่แค่ breadth

    บรีฟทดลองฉบับแรกเขียน "สัปดาห์ปัจจุบันของ SPY" และ "ปริมาณซื้อขายใน
    สัปดาห์นี้" — ทั้งสองคำมาจากป้ายชื่อที่เราเขียนเอง ไม่ใช่โมเดลดื้อ
    """
    for f in SEL.facts:
        for w in READER_RELATIVE_WORDS:
            assert w not in f.label, f"{f.id} มีคำว่า {w} อยู่ในป้ายชื่อ"
    for f in SEL_V1.facts:
        for w in READER_RELATIVE_WORDS:
            assert w not in f.label, f"{f.id} (v1) มีคำว่า {w} อยู่ในป้ายชื่อ"


def test_weekly_volume_labels_name_the_real_week():
    # ยึดกับวันที่จริงจากแผ่น ตามกติกาเดียวกับที่ห้ามคำว่า "วันนี้"
    labels = [f.label for f in SEL.facts if f.id.startswith("volw.")]
    assert labels
    for lab in labels:
        assert "สัปดาห์ที่เริ่ม 2026-11-02" in lab, lab


def test_weekly_volume_labels_fall_back_when_the_sheet_has_no_week_start():
    s = sheet()
    del s["groups"]["ret.week"]["week_start"]
    labels = [f.label for f in bf.select_facts(s).facts if f.id.startswith("volw.")]
    assert labels
    for lab in labels:
        assert "สัปดาห์ที่ปิดแล้ว" in lab, lab
        for w in READER_RELATIVE_WORDS:
            assert w not in lab


def test_seasonal_labels_do_not_call_a_finished_week_current():
    labels = [f.label for f in SEL.facts if f.id.startswith("seasonal.week_current")]
    assert labels
    for lab in labels:
        assert "สัปดาห์ที่ปิดแล้ว" in lab
        assert "สัปดาห์ปัจจุบัน" not in lab


def test_gate3_refuses_calling_a_finished_week_current_but_allows_this_week():
    """"สัปดาห์ปัจจุบัน" ผิดแม้ตอนเผยแพร่ เพราะสัปดาห์นั้นปิดไปแล้ว

    ส่วน "สัปดาห์นี้" ไม่ห้าม: มติ 17 บังคับให้บรีฟออกในสัปดาห์ ISO เดียวกับ
    วันข้อมูล คำนั้นจึงเป็นจริงตอนที่คนอ่านได้รับ · ถ้าห้ามด้วยจะกลายเป็น
    ด่านที่ร้องผิด ซึ่งเป็นความผิดพลาดที่ข้อ 8.3 เตือนไว้
    """
    assert "สัปดาห์ปัจจุบัน" in bg.VAGUE_TIME_TH
    assert "สัปดาห์นี้" not in bg.VAGUE_TIME_TH
    f = bg.gate3_language(say("สัปดาห์ปัจจุบันของ SPY เคยปิดบวก 60.00%", []))
    assert [x.code for x in f] == ["vague_time"]
    assert bg.gate3_language(say("ปริมาณซื้อขายสัปดาห์นี้สูงกว่าฐาน", [])) == []


def test_prompt_tells_the_model_to_speak_in_weeks_first():
    heading, what = bp.SECTIONS[0]
    assert heading == "ภาพรวม"
    assert "สัปดาห์" in what
    assert bp.PROMPT_VERSION == "v2.3"


# ===========================================================================
# รอบ B2a.2 · หมายเลขงวด · ตัวเลขในป้ายชื่อ · ขอบเขตของคำขยายสองค่า · แผ่นจริง
# ===========================================================================

import json as _json
from pathlib import Path as _Path

GOLDEN_PATH = _Path(__file__).parent / "fixtures" / "daily_facts_2026-11-13_v2.json"


def golden():
    """แผ่นจริงของ 13 พ.ย. 2026 (v2) ตัดกลุ่มที่บทสรุปไม่ได้อ่าน · ดูหัวไฟล์"""
    return _json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


# ------------------------------------------------------------- หมายเลขงวด

def test_period_numbers_are_facts_so_the_brief_may_name_the_week():
    """"สัปดาห์ที่ 46" คือชื่อของงวด เหมือน "อันดับ 1" · ด่าน 1 ตรวจทุกตัวเลข
    กับ fact ที่ประโยคอ้าง ถ้าไม่ส่ง period เป็น fact เลข 46 จะไม่มีอะไรรองรับ
    และบทสรุปถูกกักทุกสัปดาห์ (เกิดจริง 15 พ.ย. 2026 รอบ no-write ที่สอง)
    """
    index = SEL.by_id()
    assert index["seasonal.week_current.period"].value == 46
    assert index["seasonal.week_next.period"].value == 47
    assert index["seasonal.month_next.period"].value == 12
    assert index["seasonal.week_current.period"].unit == "count"
    # ประโยคที่เอ่ยเลขสัปดาห์ต้องผ่านด่าน 1 ได้เมื่ออ้าง fact นี้
    ok = say("ในอดีต SPY สัปดาห์ที่ 46 เคยปิดบวก 60.00% จาก 10 ครั้ง "
             "เทียบค่าปกติทุกสัปดาห์ 58.90%",
             ["seasonal.week_current.period", "seasonal.week_current.win_pct",
              "seasonal.week_current.n", "seasonal_baseline.week.win_pct"])
    assert bg.gate1_numbers(ok, SEL) == []
    # และยังต้องถูกกักถ้าเขียนเลขสัปดาห์ผิด
    bad = say("ในอดีต SPY สัปดาห์ที่ 45 เคยปิดบวก 60.00% จาก 10 ครั้ง "
              "เทียบค่าปกติทุกสัปดาห์ 58.90%",
              ["seasonal.week_current.period", "seasonal.week_current.win_pct",
               "seasonal.week_current.n", "seasonal_baseline.week.win_pct"])
    assert [x.code for x in bg.gate1_numbers(bad, SEL)] == ["unbacked_number"]


def test_period_labels_name_the_week_and_the_thai_month():
    index = SEL.by_id()
    assert "สัปดาห์ที่ 46" in index["seasonal.week_current.win_pct"].label
    assert "สัปดาห์ที่ 47" in index["seasonal.week_next.win_pct"].label
    m = index["seasonal.month_next.win_pct"].label
    assert "เดือนที่ 12" in m and "ธันวาคม" in m


# ------------------------------------------ ตัวเลขในป้ายชื่อต้องเป็น fact เสมอ

def _label_numbers_without_a_fact(sel) -> list[tuple[str, float]]:
    """เอาตัวดึงตัวเลขของด่าน 1 มารันกับป้ายชื่อ fact ทุกอัน

    ป้ายชื่อคือสิ่งที่โมเดลลอกไปเขียน · ตัวเลขใดในป้ายที่ด่าน 1 จะเรียกหา fact
    (ไม่ใช่วันที่ · ไม่ใช่ความยาวหน้าต่าง ≤31 ที่ตามด้วยหน่วยเวลา · ไม่ใช่
    อันดับ · ไม่ใช่เลขที่ติดกับชื่อตัวชี้วัด) ต้องเท่ากับค่าของ fact สักตัว
    ไม่งั้นโมเดลจะเขียนเลขนั้นแล้วถูกกักในโปรดักชัน — "(46)" เคยเป็นแบบนี้
    """
    values = [f.value for f in sel.facts if f.value is not None]
    missing = []
    for f in sel.facts:
        for n, _tail in bg._numbers(f.label):
            if not any(bg._matches(n, v) for v in values):
                missing.append((f.id, n))
    return missing


def test_every_number_shown_in_a_label_is_backed_by_a_fact():
    assert _label_numbers_without_a_fact(SEL) == []
    assert _label_numbers_without_a_fact(SEL_V1) == []


def test_the_label_number_check_itself_can_go_red():
    # ชุดเทสต์ต้องพิสูจน์ว่าแดงได้: ป้ายที่มีเลข 46 โดยไม่มี fact ค่า 46 ต้องถูกจับ
    sel = bf.Selection(
        facts=[bf.Fact(id="x.one", label="SPY สัปดาห์ที่ปิดแล้ว (สัปดาห์ที่ 46) อะไรสักอย่าง",
                       value=60.0, unit="pct_level")],
        universe=set(), trade_date="2026-11-13")
    assert _label_numbers_without_a_fact(sel) == [("x.one", 46.0)]


# ----------------------------------------- คำขยายสองค่า: ไม่สมมาตรโดยตั้งใจ

def _weak_sheet():
    s = sheet()
    s["groups"]["breadth"]["today"]["pct"] = 45.1612903225806
    s["groups"]["breadth"]["today"]["above"] = 42
    return bf.select_facts(s)


def _two_sentence_section(first_facts, second_facts, heading="ความกว้างของตลาดและปฏิทิน"):
    return {"sections": [{"heading": heading, "sentences": [
        {"text": "ความกว้างของตลาดอ่อนแอลง อยู่ที่ 45.16% หรือ 42 กอง จาก 93 กอง",
         "facts": first_facts},
        {"text": "เทียบกับ 21 วันก่อนหน้าที่ 54.84%", "facts": second_facts},
    ]}]}


def test_fragile_word_passes_when_the_comparison_sits_in_the_next_sentence():
    """15 พ.ย. 2026 รอบ no-write ที่สอง: ข้อมูลเดียวกัน กฎเดียวกัน ผ่านเมื่อ
    โมเดลเขียนรวมประโยค ถูกกักเมื่อแยกประโยค — ด่านกำลังวัดตำแหน่งจุด
    """
    sel = _weak_sheet()
    r = _two_sentence_section(
        ["breadth.today.pct", "breadth.today.above", "breadth.today.universe"],
        ["breadth.prior_21d.pct"])
    assert bg.gate4_adjectives(r, sel) == []
    assert bg.gate1_numbers(r, sel) == []


def test_fragile_word_still_needs_the_current_value_in_its_own_sentence():
    # คำขยายต้องเกาะอยู่กับตัวเลขที่มันตัดสิน · ประโยคที่มีคำแต่ไม่อ้างค่าล่าสุด
    # ต้องถูกกัก แม้หัวข้อเดียวกันจะมีค่าทั้งสองอยู่ในประโยคอื่น
    sel = _weak_sheet()
    r = {"sections": [{"heading": "ความกว้างของตลาดและปฏิทิน", "sentences": [
        {"text": "ภาวะตลาดอ่อนแอลง", "facts": []},
        {"text": "สัดส่วนเหนือ SMA200 อยู่ที่ 45.16% จาก 54.84% เมื่อ 21 วันก่อน",
         "facts": ["breadth.today.pct", "breadth.prior_21d.pct"]},
    ]}]}
    f = bg.gate4_adjectives(r, sel)
    assert [x.code for x in f] == ["unbacked_adjective"]
    assert "ประโยคนี้" in f[0].detail


def test_fragile_word_does_not_borrow_the_comparison_from_another_section():
    sel = _weak_sheet()
    r = {"sections": [
        {"heading": "ภาพรวม", "sentences": [
            {"text": "ความกว้าง 21 วันก่อนอยู่ที่ 54.84%", "facts": ["breadth.prior_21d.pct"]}]},
        {"heading": "ความกว้างของตลาดและปฏิทิน", "sentences": [
            {"text": "ความกว้างของตลาดอ่อนแอลง อยู่ที่ 45.16%", "facts": ["breadth.today.pct"]}]},
    ]}
    assert [x.code for x in bg.gate4_adjectives(r, sel)] == ["unbacked_adjective"]


def test_fragile_word_direction_is_still_checked_across_sentences():
    # ขอบเขตกว้างขึ้น แต่เงื่อนไขตัวเลขไม่ผ่อน: ถ้าค่าเดิมต่ำกว่า (กำลังดีขึ้น) ต้องกัก
    s = sheet()
    s["groups"]["breadth"]["today"]["pct"] = 45.1612903225806
    s["groups"]["breadth"]["prior_21d"]["pct"] = 40.0
    sel = bf.select_facts(s)
    r = {"sections": [{"heading": "ความกว้างของตลาดและปฏิทิน", "sentences": [
        {"text": "ความกว้างของตลาดอ่อนแอลง อยู่ที่ 45.16%", "facts": ["breadth.today.pct"]},
        {"text": "เทียบกับ 21 วันก่อนที่ 40.00%", "facts": ["breadth.prior_21d.pct"]},
    ]}]}
    assert [x.code for x in bg.gate4_adjectives(r, sel)] == ["unbacked_adjective"]


def test_single_value_adjectives_keep_sentence_scope():
    # ผ่อนเฉพาะคำสองค่า · "ผิดปกติ" ยังต้องมีเปอร์เซ็นไทล์ในประโยคเดียวกัน
    r = {"sections": [{"heading": "คู่เทียบ", "sentences": [
        {"text": "ส่วนต่าง QQQ − SPY ต่ำผิดปกติ", "facts": []},
        {"text": "อยู่ที่เปอร์เซ็นไทล์ 0.11", "facts": ["pair.qqq_spy.pctile_3y"]},
    ]}]}
    # "ต่ำผิดปกติ" ชนทั้ง "ผิดปกติ" และ "ต่ำผิดปกติ" ในบัญชี จึงได้สอง finding
    f = bg.gate4_adjectives(r, SEL)
    assert f and all(x.code == "unbacked_adjective" for x in f)


# -------------------------------------------------- แผ่นจริง (golden fixture)

def test_golden_sheet_matches_its_recorded_md5():
    """ไฟล์นี้ต้องเป็นแผ่นจริงทุกไบต์ ไม่ใช่สิ่งที่ใครเข้าใจว่าแผ่นจริงเป็น

    md5 คิดจากข้อความ JSON ของ sheet ตามรูปแบบ jsonb::text ของ Postgres
    ซึ่งเป็นสิ่งที่คิวรีในหัวไฟล์คืนมา · ถ้าใครแก้ค่าในไฟล์ด้วยมือ เทสต์นี้แดง
    """
    import hashlib
    txt = GOLDEN_PATH.read_text(encoding="utf-8")
    start = txt.index('"sheet": ') + len('"sheet": ')
    end = txt.rindex("\n}")
    g = golden()
    assert hashlib.md5(txt[start:end].encode("utf-8")).hexdigest() == g["trimmed_md5"]
    assert len(txt[start:end]) == g["trimmed_chars"]


def test_golden_sheet_is_accepted_by_gate0_and_selects_every_group():
    g = golden()["sheet"]
    assert g["meta"]["facts_version"] == "v2"
    assert bf.missing_groups(g) == []
    sel = bf.select_facts(g)
    ids = {f.id for f in sel.facts}
    for prefix in ("ret.", "retw.", "volw.", "beta.", "rank.", "pair.", "breadth.",
                   "events.", "seasonal.", "seasonal_baseline.", "risk."):
        assert any(i.startswith(prefix) for i in ids), f"ไม่มี fact ขึ้นต้นด้วย {prefix}"


def test_golden_sheet_values_reach_the_model_unchanged():
    # ตัวเลขที่ตรวจกับฐานข้อมูลจริงเมื่อ 15 พ.ย. 2026
    sel = bf.select_facts(golden()["sheet"])
    index = sel.by_id()
    assert index["retw.SPY.1w"].value == 2.5948969331844
    assert index["volw.PAWZ.z"].value == 1.70983070668752
    assert index["volw.PAWZ.rvol"].value == 2.34441757717997
    assert index["seasonal.week_current.period"].value == 46
    assert index["seasonal_baseline.week.n"].value == 521
    assert index["breadth.today.pct"].value == 45.1612903225806
    assert "สัปดาห์ที่เริ่ม 2026-11-09" in index["volw.PAWZ.z"].label


def test_golden_sheet_labels_pass_the_same_label_rules_as_the_synthetic_one():
    sel = bf.select_facts(golden()["sheet"])
    for f in sel.facts:
        for w in READER_RELATIVE_WORDS:
            assert w not in f.label, f"{f.id}: {w}"
        for code in bg.RAW_CODES:
            assert code not in f.label, f"{f.id}: {code}"
    assert _label_numbers_without_a_fact(sel) == []


def test_golden_sheet_reproduces_the_second_no_write_run_and_now_passes():
    """ประโยคที่ถูกกักจริงเมื่อ 15 พ.ย. 2026 (เลขสัปดาห์ + การเปรียบเทียบที่แยกประโยค)
    ต้องผ่านด้วยกฎของรอบนี้ โดยตัวเลขทุกตัวยังถูกตรวจ
    """
    sel = bf.select_facts(golden()["sheet"])
    r = {"sections": [
        {"heading": "ความกว้างของตลาดและปฏิทิน", "sentences": [
            {"text": "ภาวะตลาดอ่อนแอลง โดยสัดส่วนกองทุนที่อยู่เหนือ SMA200 ณ วันที่ 2026-11-13 "
                     "ลดลงมาอยู่ที่ 45.16% หรือคิดเป็น 42 กองจากทั้งหมด 93 กองทุนที่ติดตาม",
             "facts": ["breadth.today.pct", "breadth.today.above", "breadth.today.universe"]},
            {"text": "เมื่อเทียบกับ 21 วันก่อนหน้าที่สัดส่วนกองทุนเหนือ SMA200 อยู่ที่ 55.91% "
                     "หรือคิดเป็น 52 กองจากทั้งหมด 93 กองทุนที่ติดตาม",
             "facts": ["breadth.prior_21d.pct", "breadth.prior_21d.above",
                       "breadth.prior_21d.universe"]},
        ]},
        {"heading": "สถิติฤดูกาล", "sentences": [
            {"text": "ในอดีต SPY สัปดาห์ที่ 46 เคยมีสัดส่วนครั้งที่ปิดบวก 60.00% และมีผลตอบแทน"
                     "เฉลี่ย +0.27% จากการคิดคำนวณ 10 ครั้ง เมื่อเทียบกับค่าปกติทุกสัปดาห์ที่มี"
                     "สัดส่วนปิดบวก 58.90% และผลตอบแทนเฉลี่ย +0.29% จาก 521 งวด",
             "facts": ["seasonal.week_current.period", "seasonal.week_current.win_pct",
                       "seasonal.week_current.mean_pct", "seasonal.week_current.n",
                       "seasonal_baseline.week.win_pct", "seasonal_baseline.week.mean_pct",
                       "seasonal_baseline.week.n"]},
        ]},
    ]}
    assert bg.validate(r, sel) == []


# ===========================================================================
# รอบ B2a.3 · หมายเลขงวดถูกบ่งชี้ด้วยหน้าต่างที่ประโยคอ้าง
# ===========================================================================

def test_week_number_passes_when_the_sentence_cites_the_window_without_the_period():
    """ประโยคจริงจากรอบ no-write ที่สาม (15 พ.ย. 2026)

    B2a.2 ส่ง seasonal.*.period เป็น fact แล้ว แต่โมเดลอ้างเฉพาะ win_pct /
    mean_pct / n กับฐานเทียบ · เลข 46 จึงยังถูกกัก · การอ้าง fact ของ
    week_current ผูกประโยคกับหน้าต่างนั้นไปแล้ว หมายเลขงวดจึงถูกบ่งชี้
    """
    sentence = say(
        "ในอดีต SPY สัปดาห์ที่ 46 เคยปิดบวก 60.00% มีผลตอบแทนเฉลี่ย +0.42% "
        "จาก 10 ครั้ง เมื่อเทียบกับค่าปกติทุกสัปดาห์ที่ปิดบวก 58.90% "
        "และมีผลตอบแทนเฉลี่ย +0.21% จาก 150 งวด",
        ["seasonal.week_current.win_pct", "seasonal.week_current.mean_pct",
         "seasonal.week_current.n", "seasonal_baseline.week.win_pct",
         "seasonal_baseline.week.mean_pct", "seasonal_baseline.week.n"])
    assert bg.gate1_numbers(sentence, SEL) == []


def test_a_wrong_week_number_is_still_held():
    bad = say("ในอดีต SPY สัปดาห์ที่ 45 เคยปิดบวก 60.00% จาก 10 ครั้ง "
              "เทียบค่าปกติทุกสัปดาห์ 58.90%",
              ["seasonal.week_current.win_pct", "seasonal.week_current.n",
               "seasonal_baseline.week.win_pct"])
    assert [x.code for x in bg.gate1_numbers(bad, SEL)] == ["unbacked_number"]


def test_one_window_does_not_imply_another_windows_number():
    """อ้างแต่สัปดาห์ที่ปิดแล้ว (46) แล้วเขียนเลขของสัปดาห์ถัดไป (47) ต้องถูกกัก

    ถ้าไม่มีเทสต์นี้ การเผลอบ่งชี้ period ของทุกหน้าต่างพร้อมกันจะไม่ทำให้
    ชุดเทสต์แดง และบรีฟจะเขียนเลขสัปดาห์สลับกันได้โดยไม่มีใครจับ
    """
    bad = say("ในอดีต SPY สัปดาห์ที่ 47 เคยปิดบวก 60.00% จาก 10 ครั้ง "
              "เทียบค่าปกติทุกสัปดาห์ 58.90%",
              ["seasonal.week_current.win_pct", "seasonal.week_current.n",
               "seasonal_baseline.week.win_pct"])
    assert [x.code for x in bg.gate1_numbers(bad, SEL)] == ["unbacked_number"]
    # แต่ประโยคที่อ้างทั้งสองหน้าต่างพูดถึงได้ทั้งสองเลข
    ok = say("ในอดีต SPY สัปดาห์ที่ 46 เคยปิดบวก 60.00% ส่วนสัปดาห์ที่ 47 เคยปิดบวก 70.00% "
             "เทียบค่าปกติทุกสัปดาห์ 58.90%",
             ["seasonal.week_current.win_pct", "seasonal.week_next.win_pct",
              "seasonal_baseline.week.win_pct"])
    assert bg.gate1_numbers(ok, SEL) == []


def test_the_implied_period_does_not_admit_other_values_of_that_window():
    # บ่งชี้เฉพาะ period · ค่าอื่นของหน้าต่างเดียวกันที่ไม่ได้อ้าง ยังไม่ผ่าน
    bad = say("ในอดีต SPY สัปดาห์ที่ 46 เคยมีผลตอบแทนเฉลี่ย +0.42%",
              ["seasonal.week_current.win_pct"])
    assert [x.code for x in bg.gate1_numbers(bad, SEL)] == ["unbacked_number"]


def test_monthly_period_works_the_same_way():
    ok = say("ในอดีต SPY เดือนที่ 12 เคยปิดบวก 65.00% จาก 20 ครั้ง "
             "เทียบค่าปกติทุกเดือน 62.30%",
             ["seasonal.month_next.win_pct", "seasonal.month_next.n",
              "seasonal_baseline.month.win_pct"])
    assert bg.gate1_numbers(ok, SEL) == []


def test_non_seasonal_facts_imply_no_period():
    # กลไกนี้ผูกกับตระกูล seasonal เท่านั้น ห้ามรั่วไปตระกูลอื่น
    assert bg._implied_periods(["ret.SPY.21d", "rank.all_top.1"], SEL.by_id()) == []
    assert bg._implied_periods(["seasonal_baseline.week.win_pct"], SEL.by_id()) == []
    got = bg._implied_periods(["seasonal.week_current.n"], SEL.by_id())
    assert [f.id for f in got] == ["seasonal.week_current.period"]


def test_the_real_held_brief_now_passes_every_gate_on_the_real_sheet():
    """ทั้งสองประโยคที่ถูกกักจริงเมื่อ 15 พ.ย. 2026 รอบที่สาม ด้วยแผ่นจริง"""
    sel = bf.select_facts(golden()["sheet"])
    r = {"sections": [{"heading": "สถิติฤดูกาล", "sentences": [
        {"text": "ในอดีต SPY สัปดาห์ที่ 46 เคยปิดบวก 60.00% มีผลตอบแทนเฉลี่ย +0.27% "
                 "จาก 10 ครั้ง เมื่อเทียบกับค่าปกติทุกสัปดาห์ที่ปิดบวก 58.90% "
                 "และมีผลตอบแทนเฉลี่ย +0.29% จาก 521 งวด",
         "facts": ["seasonal.week_current.win_pct", "seasonal.week_current.mean_pct",
                   "seasonal.week_current.n", "seasonal_baseline.week.win_pct",
                   "seasonal_baseline.week.mean_pct", "seasonal_baseline.week.n"]},
        {"text": "สำหรับสัปดาห์ที่ 47 ในอดีต SPY เคยปิดบวก 50.00% มีผลตอบแทนเฉลี่ย -0.23% "
                 "จาก 10 ครั้ง เทียบกับค่าปกติทุกสัปดาห์ที่ปิดบวก 58.90% และเฉลี่ย +0.29%",
         "facts": ["seasonal.week_next.win_pct", "seasonal.week_next.mean_pct",
                   "seasonal.week_next.n", "seasonal_baseline.week.win_pct",
                   "seasonal_baseline.week.mean_pct"]},
    ]}]}
    assert bg.validate(r, sel) == []


# ===========================================================================
# รอบ B2b-1 · ความผันผวนและตำแหน่งราคา (กลุ่ม risk) · คำว่า แข็งแกร่ง / ขยายตัวชัด
# ===========================================================================

RISK_KEYS = ["atr_pct", "atr_pctile_1y", "pos_52w", "pct_from_high"]


def test_risk_facts_reach_the_model_for_the_funds_the_brief_already_covers():
    ids = {f.id for f in SEL.facts if f.id.startswith("risk.")}
    for t in ("SPY", "QQQ", "DBC", "PAWZ"):       # asset class · broad · หัวแถว
        for k in RISK_KEYS:
            assert f"risk.{t}.{k}" in ids
    # XLK มีค่าอยู่ในแผ่น แต่ไม่ใช่กองที่บทสรุปพูดถึงอยู่แล้ว
    assert not any(i.startswith("risk.XLK") for i in ids)
    index = SEL.by_id()
    assert index["risk.SPY.pos_52w"].value == 82.48
    assert index["risk.SPY.pct_from_high"].value == -3.49
    assert index["risk.SPY.atr_pctile_1y"].unit == "pctile"


def test_risk_values_follow_the_sheets_keys_not_a_fixed_position():
    # สลับคอลัมน์ในแผ่น: ค่าต้องตามชื่อคีย์ไป ไม่ใช่ตามตำแหน่งเดิม
    s = sheet()
    s["groups"]["risk"]["keys"] = ["pos_52w", "pct_from_high", "atr_pct", "atr_pctile_1y"]
    s["groups"]["risk"]["values"]["SPY"] = [82.48, -3.49, 1.69, 100]
    index = bf.select_facts(s).by_id()
    assert index["risk.SPY.pos_52w"].value == 82.48
    assert index["risk.SPY.atr_pct"].value == 1.69
    assert index["risk.SPY.atr_pctile_1y"].value == 100

    # คีย์ที่แผ่นไม่มี ต้องไม่ถูกส่ง (ไม่ใช่ส่งค่าของคอลัมน์ข้าง ๆ ไปแทน)
    s2 = sheet()
    s2["groups"]["risk"]["keys"] = ["atr_pct", "atr_pctile_1y", "pos_52w"]
    s2["groups"]["risk"]["values"]["SPY"] = [1.69, 100, 82.48]
    ids2 = {f.id for f in bf.select_facts(s2).facts}
    assert "risk.SPY.pos_52w" in ids2 and "risk.SPY.pct_from_high" not in ids2


def test_a_sheet_without_risk_still_makes_a_brief():
    # risk ไม่อยู่ใน REQUIRED_GROUPS โดยตั้งใจ: แผ่น v1 ที่แช่แข็งแล้วต้องไม่ถูกกัก
    for mutate in (lambda g: g.pop("risk"),
                   lambda g: g.__setitem__("risk", {"available": False})):
        s = sheet()
        mutate(s["groups"])
        assert bf.missing_groups(s) == []
        assert not any(f.id.startswith("risk.") for f in bf.select_facts(s).facts)


def test_risk_labels_call_the_window_one_year_and_never_fifty_two_weeks():
    labels = [f.label for f in SEL.facts if f.id.startswith("risk.")]
    assert labels
    for label in labels:
        assert "52" not in label and "สัปดาห์" not in label, label
    for f in SEL.facts:
        if f.id.endswith((".atr_pctile_1y", ".pos_52w", ".pct_from_high")):
            assert "กรอบ 1 ปี" in f.label, f.id


def test_writing_fifty_two_weeks_is_held_because_no_fact_carries_that_number():
    r = say("SPY อยู่ที่ 82.48% ของกรอบ 52 สัปดาห์", ["risk.SPY.pos_52w"])
    assert [x.code for x in bg.gate1_numbers(r, SEL)] == ["unbacked_number"]
    ok = say("SPY อยู่ที่ 82.48% ของกรอบ 1 ปี ห่างจากจุดสูงสุดของกรอบ 3.49% ในทิศลดลง",
             ["risk.SPY.pos_52w", "risk.SPY.pct_from_high"])
    assert bg.validate(ok, SEL) == []


def test_position_is_printed_as_a_level_and_distance_keeps_its_sign():
    text = bp.build_user(SEL)
    assert "risk.SPY.pos_52w | " in text
    pos_line = next(l for l in text.splitlines() if l.startswith("risk.SPY.pos_52w |"))
    assert pos_line.endswith("| 82.48%"), pos_line        # ไม่มี + นำหน้า
    high_line = next(l for l in text.splitlines() if l.startswith("risk.SPY.pct_from_high |"))
    assert high_line.endswith("| -3.49%"), high_line
    atr_line = next(l for l in text.splitlines() if l.startswith("risk.SPY.atr_pct |"))
    assert atr_line.endswith("| 1.69%"), atr_line


def test_gate3_refuses_raw_risk_keys_in_the_prose():
    for code in ("pos_52w", "atr_pctile_1y", "pct_from_high", "atr_pct"):
        f = bg.gate3_language(say(f"SPY มี {code} สูง", ["risk.SPY.pos_52w"]))
        assert any(x.code == "raw_code" for x in f), code


def _codes4(text, facts, sel=None):
    return [x.code for x in bg.gate4_adjectives(say(text, facts), sel or SEL)]


def test_strong_word_needs_a_position_in_the_upper_part_of_the_range():
    assert bg.STRONG_POS_MIN == 80.0
    # SPY 82.48 ถึงเกณฑ์
    assert _codes4("SPY แข็งแกร่ง อยู่ที่ 82.48% ของกรอบ 1 ปี", ["risk.SPY.pos_52w"]) == []
    # QQQ 60.20 ไม่ถึง
    assert _codes4("QQQ แข็งแกร่ง อยู่ที่ 60.20% ของกรอบ 1 ปี",
                   ["risk.QQQ.pos_52w"]) == ["unbacked_adjective"]
    # ไม่ได้อ้างตำแหน่งราคาเลย
    assert _codes4("SPY แข็งแกร่ง", ["retw.SPY.1w"]) == ["unbacked_adjective"]
    # ขอบเกณฑ์: 80 พอดีผ่าน · 79.99 ไม่ผ่าน
    for value, want in ((80.0, []), (79.99, ["unbacked_adjective"])):
        sel = bf.Selection(facts=[bf.Fact(id="risk.AAA.pos_52w", label="x", value=value,
                                          unit="pct_level", ticker="AAA")],
                           universe={"AAA"}, trade_date="2026-11-13")
        assert _codes4("AAA แข็งแกร่ง", ["risk.AAA.pos_52w"], sel) == want, value


def test_strong_word_is_tied_to_the_position_fact_not_to_any_high_level():
    # สัดส่วนอื่นที่สูงเกิน 80 (เช่น breadth หรือสถิติฤดูกาล) ไม่ได้พิสูจน์ว่ากองไหนแข็งแกร่ง
    sel = bf.Selection(
        facts=[bf.Fact(id="breadth.today.pct", label="x", value=85.0, unit="pct_level"),
               bf.Fact(id="risk.AAA.atr_pct", label="x", value=90.0, unit="pct_level",
                       ticker="AAA")],
        universe={"AAA"}, trade_date="2026-11-13")
    assert _codes4("ตลาดแข็งแกร่ง 85%", ["breadth.today.pct"], sel) == ["unbacked_adjective"]
    assert _codes4("AAA แข็งแกร่ง", ["risk.AAA.atr_pct"], sel) == ["unbacked_adjective"]


def test_expand_word_needs_an_atr_percentile_at_the_top_of_the_range():
    assert bg.EXPAND_ATR_PCTILE == 90.0
    assert _codes4("ATR ของ SPY ขยายตัวชัด ที่เปอร์เซ็นไทล์ 100 ของกรอบ 1 ปี",
                   ["risk.SPY.atr_pctile_1y"]) == []
    assert _codes4("ATR ของ DBC ขยายตัวชัด ที่เปอร์เซ็นไทล์ 61.90",
                   ["risk.DBC.atr_pctile_1y"]) == ["unbacked_adjective"]
    for value, want in ((90.0, []), (89.99, ["unbacked_adjective"])):
        sel = bf.Selection(facts=[bf.Fact(id="risk.AAA.atr_pctile_1y", label="x",
                                          value=value, unit="pctile", ticker="AAA")],
                           universe={"AAA"}, trade_date="2026-11-13")
        assert _codes4("ATR ของ AAA ขยายตัวชัด", ["risk.AAA.atr_pctile_1y"], sel) == want


def test_expand_word_is_not_satisfied_by_a_percentile_of_something_else():
    # 98.74 คือเปอร์เซ็นไทล์ของส่วนต่างคู่ ไม่ใช่ของความผันผวน
    assert SEL.by_id()["pair.lowbeta_highbeta.pctile_3y"].value > bg.EXPAND_ATR_PCTILE
    assert _codes4("ความผันผวนขยายตัวชัด",
                   ["pair.lowbeta_highbeta.pctile_3y"]) == ["unbacked_adjective"]


def test_prompt_tells_the_model_every_conditional_word_the_gates_judge():
    """กลุ่มคำที่ด่าน 4 ตัดสินทุกกลุ่ม ต้องถูกบอกใน prompt พร้อมเกณฑ์ของมัน

    เทสต์เดิม (test_prompt_rules_and_gates_agree_on_every_word) ตรวจห้ากลุ่มแรก
    เทสต์นี้ไล่กลุ่มที่เพิ่มทีหลังทั้งหมด รวมสองคำของรอบ B2b-1
    """
    for group in (bg.WIDE_WORDS, bg.VOLUME_WORDS, bg.FRAGILE_WORDS,
                  bg.DIVERGE_WORDS, bg.STRONG_WORDS, bg.EXPAND_WORDS):
        assert group
        for w in group:
            assert w in bp.SYSTEM, f'prompt ไม่ได้บอกกติกาเรื่อง "{w}" แต่ด่านจับ'
    assert f"ถึง {bg.STRONG_POS_MIN:g} ขึ้นไป" in bp.SYSTEM
    assert f"ถึง {bg.EXPAND_ATR_PCTILE:g} ขึ้นไป" in bp.SYSTEM
    assert "กรอบ 1 ปี" in bp.SYSTEM
    # คำสองคำนี้ต้องไม่ชนกับคำห้ามของด่าน 3 ไม่งั้นใช้ไม่ได้เลยไม่ว่าจะมีตัวเลขหรือไม่
    for w in bg.STRONG_WORDS + bg.EXPAND_WORDS:
        assert bg.gate3_language(say(w, [])) == [], w


def test_the_volatility_section_exists_and_names_the_window():
    headings = [h for h, _ in bp.SECTIONS]
    assert "ความผันผวนและตำแหน่งราคา" in headings
    what = dict(bp.SECTIONS)["ความผันผวนและตำแหน่งราคา"]
    assert "กรอบ 1 ปี" in what and "52" not in what
    assert headings[-1] == "สถิติฤดูกาล"       # ลำดับท้ายไม่เปลี่ยน


def test_golden_sheet_risk_values_reach_the_model_unchanged():
    # ค่าจากฐานข้อมูลจริงของ 13 พ.ย. 2026 (ดึงเมื่อ 16 พ.ย. 2026)
    sel = bf.select_facts(golden()["sheet"])
    index = sel.by_id()
    assert index["risk.SPY.atr_pct"].value == 1.69233081621494
    assert index["risk.SPY.atr_pctile_1y"].value == 100
    assert index["risk.SPY.pos_52w"].value == 82.4772038640668
    assert index["risk.SPY.pct_from_high"].value == -3.48634888695681
    assert index["retw.SPY.13w"].value == -2.58865666334175
    risk_tickers = {f.ticker for f in sel.facts if f.id.startswith("risk.")}
    # asset class 6 + QQQ, IWM + ห้าตัวบน (FIW PAWZ PHO AGNG INDA) ไม่มีตัวซ้ำ
    assert risk_tickers == {"VNQ", "EFA", "IEF", "SPY", "EEM", "DBC", "QQQ", "IWM",
                            "FIW", "PAWZ", "PHO", "AGNG", "INDA"}
    assert sum(f.id.startswith("risk.") for f in sel.facts) == 13 * 4


def test_a_real_volatility_paragraph_passes_every_gate_on_the_real_sheet():
    sel = bf.select_facts(golden()["sheet"])
    r = {"sections": [{"heading": "ความผันผวนและตำแหน่งราคา", "sentences": [
        {"text": "ATR ของ SPY อยู่ที่ 1.69% ของราคา ขยายตัวชัด ที่เปอร์เซ็นไทล์ 100 ของกรอบ 1 ปี",
         "facts": ["risk.SPY.atr_pct", "risk.SPY.atr_pctile_1y"]},
        {"text": "ราคา SPY อยู่ที่ 82.48% ของกรอบ 1 ปี ต่ำกว่าจุดสูงสุดของกรอบ 3.49%",
         "facts": ["risk.SPY.pos_52w", "risk.SPY.pct_from_high"]},
        {"text": "FIW แข็งแกร่ง ที่ 89.50% ของกรอบ 1 ปี ขณะที่ QQQ อยู่ที่ 60.20%",
         "facts": ["risk.FIW.pos_52w", "risk.QQQ.pos_52w"]},
    ]}]}
    assert bg.validate(r, sel) == []
    # ประโยคเดียวกันแต่ยกคำประเมินให้กองที่ไม่ถึงเกณฑ์ ต้องถูกกัก
    r["sections"][0]["sentences"][2] = {
        "text": "QQQ แข็งแกร่ง ที่ 60.20% ของกรอบ 1 ปี", "facts": ["risk.QQQ.pos_52w"]}
    assert [x.code for x in bg.validate(r, sel)] == ["unbacked_adjective"]


# ------------------------------------------- ตัวซ้อม (rehearse_brief.py) ต้องไม่เน่า

def test_the_rehearsal_examples_still_mean_what_their_titles_say():
    """ตัวอย่าง "ผ่านด่านครบ" ต้องผ่านจริง และตัวอย่าง "มีปัญหา" ต้องถูกกักจริง

    ไฟล์ซ้อมเคยเน่าเงียบ ๆ ตั้งแต่รอบ B2a ถึง B2b-1: ตัวอย่างที่ควรผ่านอ้าง
    ret.SPY.1d ซึ่งถูกตัดออกไปแล้ว จึงถูกกัก 4 จุด โดยไม่มีชุดเทสต์ใดรันมัน
    """
    import rehearse_brief as rb
    sel = bf.select_facts(sheet(rb.TRADE_DATE))
    assert bg.validate(rb.GOOD, sel) == []
    assert {h for h, _ in bp.SECTIONS} >= {s["heading"] for s in rb.GOOD["sections"]}
    assert len({x.gate for x in bg.validate(rb.BAD, sel)}) >= 3
