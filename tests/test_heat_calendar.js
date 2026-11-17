// Heat Calendar (17 พ.ย. 2026): ตารางผลตอบแทนจริง ปี × งวด ในแท็บ Seasonality
//
// สิ่งที่ชุดนี้เฝ้า ไม่ใช่ "ตารางวาดออกมาได้" แต่เป็นสี่เรื่องที่พังแล้วเงียบ:
//
//   1. เลขสัปดาห์ ISO ต้องตรงกับ Postgres — ทั้งแท็บพูดถึง "สัปดาห์ที่ N" ชุด
//      เดียวกับ seasonal_stats ถ้าฝั่ง JS นับคนละแบบ จะได้นิยามงวดชุดที่สอง
//      ซึ่งเป็นสิ่งที่กติกาข้อ 7.2 ห้ามไว้ · ล็อกด้วย md5 ที่วัดจากฐานจริง
//   2. ผลตอบแทน "ทั้งปี" ของโหมดส่วนต่าง ต้องเป็น (ทบต้นกอง − ทบต้น benchmark)
//      ไม่ใช่ผลรวมของส่วนต่างรายงวด — สองวิธีนี้ให้คนละคำตอบ และวิธีที่ง่ายกว่าผิด
//   3. ไม้บรรทัดสีต้องตรึงทั้งตาราง ไม่ไล่สีรายแถว — ไม่งั้นปีที่แย่สุด −0.5%
//      จะถูกระบายแดงเข้มเท่าปีที่ −8%
//   4. Export ต้องออกทั้งสองโหมดเสมอเมื่อถูกเลือก (เคาะ 17 พ.ย.)
//
// Usage: QD_HTML=<index.html> node tests/test_heat_calendar.js

const assert = require("assert");
const crypto = require("crypto");
const { loadPage } = require("./_page");

const dom = loadPage();
const w = dom.window, QD = w.QD, doc = w.document;
const flush = (n = 6) => { let p = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r))); return p; };
const eq = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const $ = (s) => doc.querySelector(s);
const $$ = (s) => Array.from(doc.querySelectorAll(s));
const near = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${msg} (ได้ ${a} ควรได้ ${b})`);

// ---------------------------------------------------------------------
// ข้อมูลทดสอบ: รูปร่างเดียวกับที่ period_end_closes คืนจริง
// (instrument_id, period_end, adj_close) — ยืนยันกับนิยามฟังก์ชันจริง 17 พ.ย.
// ตัวเลขเลือกให้ "ผลรวมของส่วนต่าง" กับ "ส่วนต่างของผลทบต้น" ไม่เท่ากัน
// เพื่อให้ข้อ 2 ข้างบนแดงได้จริงถ้าใครเปลี่ยนไปใช้วิธีบวก
// ---------------------------------------------------------------------
const ASSET_ID = 1, SPY_ID = 2;
const ROWS = [
  { instrument_id: ASSET_ID, period_end: "2025-12-31", adj_close: 100 },
  { instrument_id: ASSET_ID, period_end: "2026-01-30", adj_close: 110 }, // +10%
  { instrument_id: ASSET_ID, period_end: "2026-02-27", adj_close: 99 },  // −10%
  { instrument_id: SPY_ID,   period_end: "2025-12-31", adj_close: 200 },
  { instrument_id: SPY_ID,   period_end: "2026-01-30", adj_close: 210 }, // +5%
  { instrument_id: SPY_ID,   period_end: "2026-02-27", adj_close: 210 }  // 0%
];

let RPC_CALLS = [];
let RPC_ROWS = ROWS;
let RPC_ERROR = null;
const sb = {
  auth: {
    async getSession() { return { data: { session: null } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
  },
  from() {
    const nothing = { select: () => nothing, eq: () => nothing, order: () => nothing, limit: () => nothing,
      then: (f, r) => Promise.resolve({ data: [], error: null }).then(f, r) };
    return nothing;
  },
  rpc(name, args) {
    const b = {
      range(a, z) { b._range = [a, z]; return b; },
      then(f, r) {
        RPC_CALLS.push({ name, args, range: b._range });
        const res = RPC_ERROR ? { data: null, error: { message: RPC_ERROR } }
                              : { data: JSON.parse(JSON.stringify(RPC_ROWS)), error: null };
        return Promise.resolve(res).then(f, r);
      }
    };
    return b;
  }
};

async function main() {
  assert.ok(QD, "window.QD namespace must exist");

  // =====================================================================
  // 1 · เลขสัปดาห์ ISO ต้องตรงกับ Postgres
  // =====================================================================
  // ค่าอ้างอิงนี้วัดจากฐานข้อมูลจริง (PostgreSQL 17.6) เมื่อ 17 พ.ย. 2026 ด้วย
  //   select md5(string_agg(d::date::text||':'||extract(isoyear from d)::int
  //          ||'-'||extract(week from d)::int, ',' order by d))
  //   from generate_series('1990-01-01'::date,'2030-12-31'::date,interval '1 day') g(d);
  // ⛔ ถ้าเทสต์นี้แดง ห้ามแก้เลข md5 — แปลว่าฝั่ง JS เริ่มนับสัปดาห์คนละแบบกับ
  //    ฐานข้อมูล ซึ่งคือบั๊กที่เทสต์นี้มีไว้จับ
  const PG_ISO_MD5 = "8a260029feb65aadeb8d68674d3bf522";
  const parts = [];
  for (let t = Date.UTC(1990, 0, 1), end = Date.UTC(2030, 11, 31); t <= end; t += 86400000) {
    const s = new Date(t).toISOString().slice(0, 10);
    const p = QD.isoWeekParts(s);
    parts.push(`${s}:${p.isoYear}-${p.week}`);
  }
  assert.strictEqual(parts.length, 14975, "ช่วงที่ตรวจต้องเท่ากับที่วัดจากฐานข้อมูล");
  assert.strictEqual(crypto.createHash("md5").update(parts.join(",")).digest("hex"), PG_ISO_MD5,
    "เลขสัปดาห์ ISO ของ JS ต้องตรงกับ extract(isoyear)/extract(week) ของ Postgres ทุกวัน");

  eq(QD.isoWeekParts("2027-01-01"), { isoYear: 2026, week: 53 }, "1 ม.ค. 2027 อยู่สัปดาห์ที่ 53 ของ ISO ปี 2026");
  eq(QD.isoWeekParts("2021-01-03"), { isoYear: 2020, week: 53 }, "3 ม.ค. 2021 ยังเป็นสัปดาห์ที่ 53 ของ 2020");
  eq(QD.isoWeekParts("2021-01-04"), { isoYear: 2021, week: 1 }, "จันทร์ 4 ม.ค. 2021 คือสัปดาห์ที่ 1");
  eq(QD.calendarCellKey("2027-01-01", "week"), { year: 2026, period: 53 }, "โหมดสัปดาห์ใช้ ISO year ไม่ใช่ปีปฏิทิน");
  eq(QD.calendarCellKey("2027-01-01", "month"), { year: 2027, period: 1 }, "โหมดเดือนใช้ปีปฏิทินตามปกติ");
  console.log("[ok] ISO week ตรงกับ Postgres ทั้ง 14,975 วัน · ขอบปีไม่เด้งผิดแถว");

  // =====================================================================
  // 2 · ผลตอบแทนรายงวด และการทบต้น
  // =====================================================================
  const byInst = QD.groupCalendarRows(ROWS);
  eq(Object.keys(byInst).sort(), ["1", "2"], "แยกตาม instrument");
  const aRet = QD.periodReturns(byInst[ASSET_ID], "month");
  assert.strictEqual(aRet.length, 2, "งวดแรกของชุดไม่มีงวดก่อนหน้าให้เทียบ จึงไม่มีผลตอบแทน");
  near(aRet[0].ret, 10, "ม.ค. 2026 = +10%");
  near(aRet[1].ret, -10, "ก.พ. 2026 = −10%");
  eq(QD.periodReturns([], "month"), [], "ชุดว่างไม่ throw");
  eq(QD.periodReturns([{ period_end: "2026-01-30", adj_close: 1 }], "month"), [], "จุดเดียวให้ผลตอบแทนไม่ได้");
  near(QD.compoundPct([10, -10]), -1, "ทบต้น +10% แล้ว −10% = −1% ไม่ใช่ 0%");
  assert.strictEqual(QD.compoundPct([]), null, "ไม่มีงวด = ไม่มีค่า ไม่ใช่ศูนย์");
  assert.strictEqual(QD.meanPct([]), null, "ค่าเฉลี่ยของชุดว่างคือไม่มีค่า");

  // =====================================================================
  // 3 · โครงตาราง abs / rel / ทั้งปี / ค่าเฉลี่ย
  // =====================================================================
  const cal = QD.buildHeatCalendar(byInst[ASSET_ID], byInst[SPY_ID], "month", null);
  eq(cal.years, [2026], "ปี 2025 ไม่ขึ้น เพราะงวดเดียวของมันคือจุดตั้งต้นที่ไม่มีผลตอบแทน");
  assert.strictEqual(cal.periods.length, 12, "โหมดเดือนมี 12 คอลัมน์เสมอ แม้ข้อมูลมีไม่ครบ");
  near(cal.cells[2026][1].abs, 10, "ช่อง ม.ค. ค่าจริง");
  near(cal.cells[2026][1].rel, 5, "ช่อง ม.ค. ส่วนต่างจาก SPY = 10 − 5");
  near(cal.cells[2026][2].rel, -10, "ช่อง ก.พ. ส่วนต่าง = −10 − 0");
  assert.strictEqual(cal.cells[2026][3], undefined, "งวดที่ไม่มีข้อมูลต้องไม่มีช่อง ไม่ใช่ศูนย์");

  near(cal.yearTotal[2026].abs, -1, "ทั้งปีของกอง = ทบต้น −1%");
  // SPY ทั้งปี = (1.05 × 1.00 − 1) = +5% → ส่วนต่าง = −1 − 5 = −6
  // ถ้าใครเปลี่ยนไปบวกส่วนต่างรายงวดจะได้ 5 + (−10) = −5 ซึ่งผิด
  near(cal.yearTotal[2026].rel, -6, "ทั้งปีโหมดส่วนต่างต้องเป็นส่วนต่างของผลทบต้น ไม่ใช่ผลรวมของส่วนต่างรายงวด");

  near(cal.periodMean[1].abs, 10, "ค่าเฉลี่ยของ ม.ค. จากปีที่แสดงอยู่");
  assert.strictEqual(cal.periodMean[1].n, 1, "บอกจำนวนปีที่ค่าเฉลี่ยนั้นคิดมาจาก");
  assert.strictEqual(cal.periodMean[5].abs, null, "เดือนที่ไม่มีข้อมูลเลย = ไม่มีค่าเฉลี่ย");

  // ไม่มี benchmark → โหมดส่วนต่างต้องไม่มีค่า ไม่ใช่เท่ากับค่าจริง
  const noBench = QD.buildHeatCalendar(byInst[ASSET_ID], [], "month", null);
  assert.strictEqual(noBench.cells[2026][1].rel, null, "ไม่มี benchmark = ไม่มีส่วนต่าง");
  assert.strictEqual(noBench.yearTotal[2026].rel, null, "ทั้งปีก็ไม่มีส่วนต่างเช่นกัน");

  // yearsToKeep: ตัดจากปีใหม่ลงไป และเรียงใหม่อยู่บน
  const longSeries = [];
  for (let y = 2020; y <= 2026; y++) {
    longSeries.push({ period_end: `${y}-01-30`, adj_close: 100 + y - 2020 });
    longSeries.push({ period_end: `${y}-02-27`, adj_close: 101 + y - 2020 });
  }
  const trimmed = QD.buildHeatCalendar(longSeries, [], "month", 3);
  eq(trimmed.years, [2026, 2025, 2024], "เก็บเฉพาะจำนวนปีที่ขอ และเรียงปีใหม่อยู่บน");
  assert.strictEqual(trimmed.cells[2023], undefined, "ปีที่ถูกตัดต้องไม่เหลือค้างใน cells");
  assert.strictEqual(trimmed.periodMean[1].n, 3, "ค่าเฉลี่ยคิดจากเฉพาะปีที่แสดงอยู่จริง");
  console.log("[ok] โครงตาราง: ส่วนต่างทั้งปีใช้ผลทบต้น · งวดว่างไม่กลายเป็นศูนย์ · ตัดปีแล้วค่าเฉลี่ยตามไปด้วย");

  // =====================================================================
  // 4 · ไม้บรรทัดสี
  // =====================================================================
  assert.strictEqual(QD.calendarScale([]), null, "ไม่มีค่า = ไม่มีไม้บรรทัด");
  assert.strictEqual(QD.calendarScale([0.1, -0.2]), 0.5, "มีพื้นขั้นต่ำ กันไม่ให้ความต่างระดับเศษเสี้ยวถูกระบายจัด");
  const many = [];
  for (let i = 1; i <= 10; i++) many.push(i);          // 1..10
  assert.strictEqual(QD.calendarScale(many), 9, "เปอร์เซ็นไทล์ 90 ของ 1..10 คือ 9 — ค่าสูงสุดถูกกันออกไว้นอกไม้บรรทัดโดยตั้งใจ");
  const withOutlier = many.concat([200]);
  assert.ok(QD.calendarScale(withOutlier) < 50, "ค่าสุดโต่งค่าเดียวต้องไม่ดึงไม้บรรทัดจนช่องอื่นซีดหมด");

  assert.strictEqual(QD.calendarColor(null, 10), null, "ไม่มีค่า = ไม่ระบายสี");
  assert.strictEqual(QD.calendarColor(5, null), null, "ไม่มีไม้บรรทัด = ไม่ระบายสี");
  assert.ok(/hsl\(142/.test(QD.calendarColor(5, 10)), "บวก = เขียว");
  assert.ok(/hsl\(6[,)]/.test(QD.calendarColor(-5, 10)), "ลบ = แดง");
  assert.strictEqual(QD.calendarColor(0, 10), QD.calendarColor(0.01, 10), "ใกล้ศูนย์ = สีกลางเหมือนกัน");
  assert.strictEqual(QD.calendarColor(5, 10), QD.calendarColor(5, 10), "ค่าเดียวกัน ไม้บรรทัดเดียวกัน = สีเดียวกันเสมอ");
  assert.notStrictEqual(QD.calendarColor(5, 10), QD.calendarColor(5, 100),
    "สีขึ้นกับไม้บรรทัด ไม่ใช่ขึ้นกับค่าอย่างเดียว — นี่คือสิ่งที่ทำให้ 'ตรึงทั้งตาราง' มีความหมาย");
  assert.strictEqual(QD.calendarColor(50, 10), QD.calendarColor(999, 10), "ค่าที่เกินไม้บรรทัดถูกตัดที่ปลาย");
  console.log("[ok] ไม้บรรทัดสี: p90 กันค่าสุดโต่ง · ศูนย์อยู่กลาง · ค่าเท่ากันสีเท่ากันทั้งตาราง");

  // =====================================================================
  // 5 · DOM — วาดตาราง สลับโหมด และปุ่มที่ใช้ไม่ได้
  // =====================================================================
  await QD.init(sb);
  QD.state.instruments = [
    { id: ASSET_ID, ticker: "QQQ", name: "Invesco QQQ", category: "broad_market" },
    { id: SPY_ID, ticker: "SPY", name: "SPDR S&P 500", category: "broad_market" }
  ];
  QD.state.assetId = ASSET_ID;
  QD.state.periodType = "month";
  QD.state.lookback = null;
  assert.strictEqual(QD.heatBenchmarkId(), SPY_ID, "benchmark หาเจอจาก ticker ไม่ใช่จาก id ที่ฝังไว้");

  RPC_CALLS = [];
  await QD.fetchHeatCalendar();
  await flush();
  const call = RPC_CALLS.find((c) => c.name === "period_end_closes");
  assert.ok(call, "ต้องขอบขอบเขตงวดจาก period_end_closes ไม่ใช่แบ่งงวดเอง");
  eq(call.args.p_instrument_ids, [ASSET_ID, SPY_ID], "ขอทั้งกองที่เลือกและ benchmark ในการเรียกครั้งเดียว");
  assert.strictEqual(call.args.p_granularity, "month");
  assert.strictEqual(call.args.p_complete_only, true, "งวดที่ยังไม่จบต้องไม่ถูกนำมาแสดง");

  const headCells = $$("#heatCalendarTable thead th").map((e) => e.textContent);
  assert.strictEqual(headCells.length, 14, "ปี + 12 เดือน + ทั้งปี");
  assert.strictEqual(headCells[0], "ปี");
  assert.strictEqual(headCells[1], "ม.ค.", "หัวคอลัมน์ใช้ชื่อย่อ");
  assert.strictEqual(headCells[13], "ทั้งปี");
  const bodyRows = $$("#heatCalendarTable tbody tr");
  assert.strictEqual(bodyRows.length, 2, "หนึ่งแถวต่อปี บวกแถวค่าเฉลี่ย");
  assert.strictEqual(bodyRows[1].children[0].textContent, "เฉลี่ย", "แถวล่างสุดคือค่าเฉลี่ยของงวดนั้น");
  assert.strictEqual(bodyRows[0].children[1].textContent, "+10.0", "ช่อง ม.ค. โหมดค่าจริง · บวกต้องมีเครื่องหมาย");
  assert.strictEqual(bodyRows[0].children[13].textContent, "-1.0", "ทั้งปีจากการทบต้น");
  assert.ok(bodyRows[0].children[1].getAttribute("style").includes("background"), "ช่องที่มีค่าต้องถูกระบายสี");
  assert.strictEqual(bodyRows[0].children[3].textContent, "", "งวดที่ไม่มีข้อมูลต้องเป็นช่องว่าง ไม่ใช่ 0.0");
  assert.ok(/ตรึงทั้งตาราง/.test($("#heatScaleNote").textContent), "ต้องบอกบนจอว่าไม้บรรทัดสีตรึงทั้งตาราง");

  // สลับโหมดต้องวาดใหม่จากข้อมูลเดิม ไม่ยิง query ซ้ำ
  const before = RPC_CALLS.length;
  $("#heatModeBtns").querySelector('[data-heat-mode="rel"]').click();
  await flush();
  assert.strictEqual(RPC_CALLS.length, before, "สลับโหมดต้องไม่โหลดข้อมูลใหม่");
  const relRows = $$("#heatCalendarTable tbody tr");
  assert.strictEqual(relRows[0].children[1].textContent, "+5.0", "โหมดส่วนต่าง: ม.ค. = 10 − 5");
  assert.strictEqual(relRows[0].children[13].textContent, "-6.0", "โหมดส่วนต่าง: ทั้งปีคือส่วนต่างของผลทบต้น");
  assert.ok(/ส่วนต่างจาก SPY/.test($("#heatNote").textContent), "คำอธิบายใต้ตารางต้องเปลี่ยนตามโหมด");

  // เลือก SPY เอง → โหมดส่วนต่างใช้ไม่ได้ และต้องเด้งกลับโหมดค่าจริง
  QD.state.assetId = SPY_ID;
  RPC_ROWS = ROWS.filter((r) => r.instrument_id === SPY_ID);
  await QD.fetchHeatCalendar();
  await flush();
  assert.strictEqual(QD.heatRelAvailable(), false, "กองที่เลือกคือ benchmark เอง → ไม่มีส่วนต่างให้ดู");
  assert.strictEqual(QD.state.heat.mode, "abs", "ต้องเด้งกลับโหมดค่าจริง ไม่ใช่โชว์ศูนย์ทั้งตาราง");
  assert.strictEqual($("#heatModeBtns").querySelector('[data-heat-mode="rel"]').disabled, true, "ปุ่มต้องถูกปิด");
  RPC_ROWS = ROWS;
  QD.state.assetId = ASSET_ID;
  await QD.fetchHeatCalendar();
  await flush();
  console.log("[ok] DOM: หัวตารางครบ · แถวเฉลี่ย · สลับโหมดไม่ยิงซ้ำ · เลือก benchmark เองแล้วปุ่มปิด");

  // =====================================================================
  // 6 · โหลดไม่สำเร็จ
  // =====================================================================
  RPC_ERROR = "JWT expired";
  await QD.fetchHeatCalendar();
  await flush();
  assert.strictEqual($("#heatError").classList.contains("hidden"), false, "โหลดพลาดต้องขึ้นข้อความ");
  assert.ok(/JWT expired/.test($("#heatError").textContent), "บอกเหตุที่แท้จริง");
  assert.ok($$("#heatCalendarTable tbody tr").length >= 2, "ของเดิมบนจอไม่ถูกล้างเพราะโหลดรอบใหม่พลาด");
  RPC_ERROR = null;
  await QD.fetchHeatCalendar();
  await flush();

  // =====================================================================
  // 7 · Export — เลือกครั้งเดียวได้ทั้งสองโหมด
  // =====================================================================
  const sheetAbs = QD.buildHeatCalendarSheet(QD.state.heat.calendar, "abs", "month");
  assert.strictEqual(sheetAbs[0][0], "ปี");
  assert.strictEqual(sheetAbs[0].length, 14, "หัวตารางของชีตเท่ากับบนหน้าจอ");
  near(sheetAbs[1][1], 10, "ค่าในชีตเป็นตัวเลขดิบ ไม่ใช่ข้อความที่จัดรูปแล้ว");
  assert.strictEqual(sheetAbs[1][3], null, "งวดที่ไม่มีข้อมูลเป็นช่องว่างในชีตด้วย");
  assert.strictEqual(sheetAbs[sheetAbs.length - 1][0], "เฉลี่ย", "แถวสุดท้ายคือค่าเฉลี่ย");
  const sheetRel = QD.buildHeatCalendarSheet(QD.state.heat.calendar, "rel", "month");
  near(sheetRel[1][1], 5, "ชีตโหมดส่วนต่างใช้ค่า rel");
  assert.strictEqual(QD.buildHeatCalendarSheet(null, "abs", "month"), null, "ไม่มีตาราง = ไม่มีชีต");

  QD.updateExportAvailability();
  assert.strictEqual($("#exportHeatmap").disabled, false, "มีตารางแล้วต้องเลือก export ได้");
  $("#exportHeatmap").checked = true;
  $("#exportOverview").checked = false;
  const sheets = QD.exportToExcel();
  assert.ok(sheets.heatAbs, "เลือก Heat Calendar แล้วต้องได้ชีตค่าจริง");
  assert.ok(sheets.heatRel, "และต้องได้ชีตส่วนต่างมาด้วยเสมอ โดยไม่ต้อง export รอบที่สอง");
  assert.strictEqual(sheets.overview, undefined, "ไม่ได้ติ๊กตารางภาพรวมก็ต้องไม่มีชีตนั้น");
  assert.strictEqual($("#exportError").classList.contains("hidden"), true, "เลือก Heat Calendar อย่างเดียวก็ export ได้");

  // ของเดิมต้องไม่เปลี่ยนรูปแบบ (กติกาข้อ 7.4)
  $("#exportOverview").checked = true;
  QD.state.overviewRows = [{ period: 1, stats: { n: 5, mean_pct: 1 } }];
  const both = QD.exportToExcel();
  assert.strictEqual(both.overview[0][0], "Period", "ชีต Overview ยังขึ้นต้นด้วย Period เหมือนเดิม");
  assert.strictEqual(both.overview[0][1], "n", "คอลัมน์ที่สองของ Overview ไม่เปลี่ยน");
  assert.ok(both.heatAbs && both.heatRel, "เลือกพร้อมกันได้");

  // ไม่ติ๊กอะไรเลยต้องเตือน ไม่ใช่เงียบ
  $("#exportHeatmap").checked = false;
  $("#exportOverview").checked = false;
  assert.strictEqual(QD.exportToExcel(), null, "ไม่เลือกอะไรเลย = ไม่ export");
  assert.strictEqual($("#exportError").classList.contains("hidden"), false, "และต้องบอกบนจอ");
  console.log("[ok] Export: ติ๊กครั้งเดียวได้สองชีต · ชีตเดิมไม่เปลี่ยนรูปแบบ · ไม่ติ๊กอะไรเลยมีคำเตือน");

  console.log("\nALL HEAT CALENDAR TESTS PASSED");
}

main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
