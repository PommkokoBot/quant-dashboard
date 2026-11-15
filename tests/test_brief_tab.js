// รอบ C′ (2026-11-15): แท็บ Brief — หน้าเว็บหน้าแรกที่อ่าน daily_brief
//
// สิ่งที่ชุดนี้เฝ้า ไม่ใช่ "หน้าเว็บวาดได้" แต่เป็นกติกาที่ย้ายจากหลังบ้านมาอยู่บนจอ:
//
//   1. ฉบับที่ตกด่าน (status='held') ห้ามขึ้นมาแทนฉบับที่เผยแพร่แล้ว
//      นี่คือกติกาเดียวกับ Phase 1 ข้อ 1.8 และเป็นจุดที่พลาดง่ายที่สุด เพราะ
//      "เอาแถวล่าสุด" เป็นสิ่งที่ทุกคนเขียนโดยอัตโนมัติ และจะดูถูกต้องทุกวัน
//      ที่บทสรุปผ่านด่าน — ผิดเฉพาะวันที่มันตก ซึ่งเป็นวันที่สำคัญที่สุด
//   2. มีฉบับใหม่กว่าที่ตกอยู่ ต้องบอกบนจอ ไม่ใช่ซ่อน
//   3. ข้อความจากโมเดลต้อง escape ทุกครั้ง (body_th/body_json ไม่ใช่ข้อความ
//      ที่เราเขียนเอง จึงถือเป็นข้อมูลภายนอก)
//   4. โหลดครั้งแรกตอนเปิดแท็บเท่านั้น (ค่า login ไม่ต้องจ่ายค่า query นี้)
//
// Usage: QD_HTML=<index.html> node tests/test_brief_tab.js

const assert = require("assert");
const { loadPage } = require("./_page");

const dom = loadPage();
const w = dom.window, QD = w.QD, doc = w.document;
const flush = (n = 6) => { let p = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r))); return p; };
const eq = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const $ = (s) => doc.querySelector(s);
const $$ = (s) => Array.from(doc.querySelectorAll(s));
const txt = (s) => ($(s) ? $(s).textContent : null);
const hidden = (s) => $(s).classList.contains("hidden");

// ---------------------------------------------------------------------
// ข้อมูลทดสอบ: รูปร่างเดียวกับของจริงใน daily_brief (ตรวจกับฐานข้อมูลจริง
// 15 พ.ย. 2026 — คอลัมน์ id/trade_date/publish_date/body_th/body_json/
// model/prompt_version/status/validation_log · body_json = {sections:[
// {heading, sentences:[{text, facts}]}]})
// ---------------------------------------------------------------------
const PUBLISHED = {
  id: 11, trade_date: "2026-11-13", publish_date: "2026-11-14",
  model: "gemini-3.6-flash", prompt_version: "v2.2", status: "published",
  validation_log: [],
  body_th: "ภาพรวม\nสัปดาห์ที่ปิดแล้ว SPY +0.42%",
  body_json: { sections: [
    { heading: "ภาพรวม", sentences: [
      { text: "สัปดาห์ที่ปิดแล้ว SPY +0.42%", facts: ["ret.week.SPY.1w"] },
      { text: "4 สัปดาห์ -1.10%", facts: ["ret.week.SPY.4w"] }
    ] },
    { heading: "คู่เทียบ", sentences: [{ text: "SPY ลบ IEF อยู่เปอร์เซ็นไทล์ 85.70", facts: ["spread.SPY_IEF.pctile"] }] }
  ] }
};
// ฉบับที่ใหม่กว่าและตกด่าน — ตัวที่ต้อง "ไม่" ขึ้นมาแทนฉบับบน
const HELD = {
  id: 12, trade_date: "2026-11-14", publish_date: "2026-11-15",
  model: "gemini-3.6-flash", prompt_version: "v2.2", status: "held",
  validation_log: [
    { gate: 1, code: "number_not_in_sheet", where: "ภาพรวม ประโยคที่ 2", detail: "3.06 ไม่ตรงกับตัวเลขใดในแผ่น" },
    { gate: 4, code: "adjective_without_support", where: "เด่นและแย่ ประโยคที่ 1", detail: "'สูงผิดปกติ' ที่เปอร์เซ็นไทล์ 60.0" }
  ],
  body_th: "ภาพรวม\nPAWZ RVOL 3.06x",
  body_json: { sections: [{ heading: "ภาพรวม", sentences: [{ text: "PAWZ RVOL 3.06x", facts: ["vol.PAWZ.rvol"] }] }] }
};
const OLD_DAILY = {   // ฉบับยุค prompt v1 ที่ยังไม่มี body_json
  id: 9, trade_date: "2026-11-11", publish_date: "2026-11-12",
  model: "gemini-3.6-flash", prompt_version: "v1", status: "published",
  validation_log: [],
  body_th: "ภาพรวม\nเมื่อ 2026-11-11 SPY -0.36%\n\nคู่เทียบ\nQQQ ลบ SPY -1.2%",
  body_json: null
};

let BRIEF_ROWS = [];
const briefQueries = [];
let briefError = null;

function makeBriefBuilder() {
  const q = { orders: [], limitN: null, cols: "" };
  const builder = {
    select(cols) { q.cols = cols; return builder; },
    order(col, opts) { q.orders.push({ col, ascending: !opts || opts.ascending !== false }); return builder; },
    limit(n) { q.limitN = n; return builder; },
    then(onFulfilled, onRejected) {
      briefQueries.push(q);
      const res = briefError
        ? { data: null, error: { message: briefError } }
        : { data: JSON.parse(JSON.stringify(BRIEF_ROWS)), error: null };
      return Promise.resolve(res).then(onFulfilled, onRejected);
    }
  };
  return builder;
}

const sb = {
  auth: {
    async getSession() { return { data: { session: null } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
  },
  from(table) {
    if (table === "daily_brief") return makeBriefBuilder();
    const nothing = {
      select: () => nothing, eq: () => nothing, order: () => nothing, limit: () => nothing,
      then: (f, r) => Promise.resolve({ data: [], error: null }).then(f, r)
    };
    return nothing;
  },
  rpc() {
    const b = { range: () => b, then: (f, r) => Promise.resolve({ data: [], error: null }).then(f, r) };
    return b;
  }
};

async function main() {
  assert.ok(QD, "window.QD namespace must exist");

  // =====================================================================
  // 1 · กติกาการเลือกฉบับ — ฟังก์ชันล้วน ไม่ต้องมี DOM
  // =====================================================================
  const rows = [HELD, PUBLISHED, OLD_DAILY];          // ใหม่ -> เก่า เหมือน query จริง
  assert.strictEqual(QD.latestPublishedBrief(rows).id, 11, "ฉบับที่ผ่านด่านล่าสุดคือ 13 พ.ย. ไม่ใช่แถวแรก");
  assert.strictEqual(QD.briefToShow(rows, null).id, 11, "ค่าตั้งต้น: ฉบับที่ตกด่าน (14 พ.ย.) ต้องไม่ขึ้นมาแทน");
  assert.strictEqual(QD.briefToShow(rows, "12").id, 12, "ผู้ใช้คลิกฉบับที่ตกจากประวัติ -> เคารพการเลือก");
  assert.strictEqual(QD.briefToShow(rows, 12).id, 12, "id เป็นตัวเลขก็ต้องได้ (DOM ให้มาเป็น string)");
  assert.strictEqual(QD.briefToShow(rows, "999").id, 11, "id ที่ไม่มีจริง (แถวหลุดไปนอก limit แล้ว) -> ตกกลับไปที่ฉบับที่ผ่านล่าสุด");
  assert.strictEqual(QD.briefToShow([HELD], null), null, "ยังไม่มีฉบับที่ผ่านเลย -> ไม่มีอะไรให้แสดง ไม่ใช่เอาฉบับที่ตกมาโชว์");
  assert.strictEqual(QD.briefToShow([], null), null, "ตารางว่าง");
  assert.strictEqual(QD.briefToShow(null, null), null, "ยังไม่ได้โหลด");

  eq(QD.newerHeldBriefs(rows, PUBLISHED).map((r) => r.id), [12], "ฉบับที่ใหม่กว่าและตกด่าน");
  eq(QD.newerHeldBriefs(rows, HELD).map((r) => r.id), [], "ถ้ากำลังดูฉบับที่ตกเอง ไม่มีอะไรใหม่กว่า");
  eq(QD.newerHeldBriefs(rows, null).map((r) => r.id), [12], "ไม่มีฉบับที่ผ่านเลย -> ฉบับที่ตกทุกฉบับคือของใหม่กว่า");
  eq(QD.newerHeldBriefs([PUBLISHED], PUBLISHED).map((r) => r.id), [], "วันที่เท่ากันไม่ใช่ 'ใหม่กว่า'");
  assert.strictEqual(QD.briefFindingCount(HELD), 2);
  assert.strictEqual(QD.briefFindingCount(PUBLISHED), 0);
  assert.strictEqual(QD.briefFindingCount({ validation_log: null }), 0, "null ไม่ใช่ 0 จุดที่ตก แต่ก็นับเป็น 0 ได้ ห้าม throw");
  console.log("[ok] กติกาเลือกฉบับ: held ไม่ทับ published · เคารพการคลิก · ไม่มีฉบับที่ผ่าน = ไม่มีอะไรแสดง");

  // =====================================================================
  // 2 · การแปลงเนื้อหา — body_json เป็นหลัก body_th เป็นทางถอย
  // =====================================================================
  const secs = QD.briefSections(PUBLISHED);
  eq(secs.map((s) => s.heading), ["ภาพรวม", "คู่เทียบ"], "หัวข้อมาจาก body_json");
  assert.strictEqual(secs[0].text, "สัปดาห์ที่ปิดแล้ว SPY +0.42% 4 สัปดาห์ -1.10%", "ประโยคในหัวข้อเดียวกันต่อกันด้วยช่องว่าง");
  const old = QD.briefSections(OLD_DAILY);
  eq(old.map((s) => s.heading), ["ภาพรวม", "คู่เทียบ"], "แถวที่ไม่มี body_json: อ่านจาก body_th ได้");
  assert.strictEqual(old[1].text, "QQQ ลบ SPY -1.2%");
  eq(QD.briefSections(null), [], "ไม่มีฉบับ -> ไม่มีหัวข้อ");
  eq(QD.briefSections({ body_th: "", body_json: null }), [], "ว่างเปล่า");
  eq(QD.briefSections({ body_th: "บรรทัดเดียวไม่มีหัวข้อ", body_json: null }),
    [{ heading: "", text: "บรรทัดเดียวไม่มีหัวข้อ" }], "ย่อหน้าบรรทัดเดียว = เนื้อหาไม่มีหัวข้อ");
  console.log("[ok] briefSections: body_json เป็นหลัก · body_th เป็นทางถอยของฉบับเก่า · ของว่างไม่ throw");

  // =====================================================================
  // 3 · DOM: โหลดครั้งแรกตอนเปิดแท็บ
  // =====================================================================
  await QD.init(sb);
  assert.strictEqual($("#tabBtnBrief") != null, true, "มีปุ่มแท็บ Brief");
  assert.strictEqual(hidden("#tabBrief"), true, "แท็บ Brief ซ่อนอยู่ตอนเริ่ม");
  assert.strictEqual(briefQueries.length, 0, "login/boot ต้องไม่ยิง query ของแท็บนี้");

  BRIEF_ROWS = [HELD, PUBLISHED, OLD_DAILY];
  $("#tabBtnBrief").click();
  await flush();
  assert.strictEqual(hidden("#tabBrief"), false, "กดปุ่มแล้วแท็บโผล่");
  assert.strictEqual($("#tabBtnBrief").classList.contains("qd-tab-active"), true, "ปุ่มติดสถานะ active");
  assert.strictEqual(hidden("#tabSeasonality"), true, "แท็บเดิมถูกซ่อน");
  assert.strictEqual(briefQueries.length, 1, "โหลดครั้งเดียวตอนเปิดแท็บ");
  eq(briefQueries[0].orders, [{ col: "trade_date", ascending: false }, { col: "id", ascending: false }],
    "เรียงใหม่ไปเก่า และ tie-break ด้วย id");
  assert.strictEqual(briefQueries[0].limitN, QD.BRIEF_HISTORY_LIMIT, "จำกัดจำนวนแถว");
  assert.ok(/body_json/.test(briefQueries[0].cols) && /validation_log/.test(briefQueries[0].cols),
    "ดึงคอลัมน์ที่หน้านี้ใช้จริง");

  $("#tabBtnBrief").click();
  await flush();
  assert.strictEqual(briefQueries.length, 1, "เปิดแท็บซ้ำไม่โหลดใหม่");

  // ---- เนื้อหาที่เห็นคือฉบับที่ผ่านด่านล่าสุด ไม่ใช่แถวแรก ----
  assert.ok(/SPY \+0\.42%/.test(txt("#briefBody")), "เนื้อหาคือฉบับ 13 พ.ย. ที่ผ่านด่าน");
  assert.ok(!/3\.06x/.test(txt("#briefBody")), "เนื้อหาของฉบับที่ตกด่านต้องไม่ปรากฏ");
  assert.ok(/13 พ\.ย\./.test(txt("#briefMeta")), "แถบข้อมูลบอกวันที่ของข้อมูล");
  assert.ok(/v2\.2/.test(txt("#briefMeta")) && /gemini/.test(txt("#briefMeta")), "บอกรุ่น prompt และโมเดล");
  assert.ok(/เผยแพร่แล้ว/.test(txt("#briefMeta")), "ป้ายสถานะ");
  assert.strictEqual(hidden("#briefFindings"), true, "ฉบับที่ผ่านด่านไม่มีรายการเหตุผล");

  // ---- บรรทัดแจ้งว่ามีฉบับใหม่กว่าที่ตก ----
  assert.strictEqual(hidden("#briefHeldNotice"), false, "ต้องบอกว่ามีฉบับใหม่กว่าที่ตกด่าน");
  assert.ok(/14 พ\.ย\./.test(txt("#briefHeldNotice")), "บอกวันที่ของฉบับที่ตก");
  assert.ok(/2 จุด/.test(txt("#briefHeldNotice")), "บอกจำนวนจุดที่ตก");
  console.log("[ok] DOM: โหลดครั้งเดียวตอนเปิดแท็บ · แสดงฉบับที่ผ่านด่านล่าสุด · แจ้งฉบับใหม่กว่าที่ตก");

  // =====================================================================
  // 4 · ประวัติ + คลิกอ่านฉบับที่ตกด่าน
  // =====================================================================
  const histRows = $$("#briefHistoryTable tr[data-brief-id]");
  assert.strictEqual(histRows.length, 3, "ประวัติครบทุกฉบับที่ดึงมา รวมฉบับที่ตก");
  eq(histRows.map((tr) => tr.getAttribute("data-brief-id")), ["12", "11", "9"], "เรียงใหม่ไปเก่า");
  assert.ok(/ไม่ผ่านด่าน/.test(histRows[0].textContent), "แถวของฉบับที่ตกมีป้ายบอก");
  assert.ok(/\b2\b/.test(histRows[0].textContent), "แถวบอกจำนวนจุดที่ตก");

  histRows[0].click();
  await flush();
  assert.ok(/3\.06x/.test(txt("#briefBody")), "คลิกแล้วอ่านเนื้อหาฉบับที่ตกได้");
  assert.strictEqual(hidden("#briefFindings"), false, "และเห็นเหตุผลที่ตกครบ");
  assert.strictEqual($$("#briefFindings li").length, 2, "สองจุด สองบรรทัด");
  assert.ok(/ด่าน 1/.test(txt("#briefFindings")) && /ด่าน 4/.test(txt("#briefFindings")), "บอกเลขด่าน");
  assert.ok(/3\.06 ไม่ตรงกับตัวเลขใดในแผ่น/.test(txt("#briefFindings")), "บอกรายละเอียดที่ด่านให้มา");
  assert.ok(/number_not_in_sheet/.test(txt("#briefFindings")), "บอกรหัสด่านไว้สาวต่อได้");
  assert.strictEqual(hidden("#briefHeldNotice"), true, "ระหว่างอ่านฉบับที่ตกเอง ไม่ต้องเตือนซ้ำ");
  assert.ok(/ไม่เผยแพร่/.test(txt("#briefMeta")), "ป้ายสถานะเปลี่ยนตามฉบับที่เลือก");

  histRows[1].click();
  await flush();
  assert.ok(/SPY \+0\.42%/.test(txt("#briefBody")), "คลิกกลับฉบับที่ผ่านด่านได้");
  assert.strictEqual(hidden("#briefFindings"), true, "รายการเหตุผลหายไปพร้อมฉบับ");
  console.log("[ok] ประวัติ: ครบทุกฉบับ เรียงใหม่ไปเก่า คลิกอ่านฉบับที่ตกและเหตุผลได้ แล้วคลิกกลับได้");

  // =====================================================================
  // 5 · ข้อความจากโมเดลคือข้อมูลภายนอก ต้อง escape
  // =====================================================================
  BRIEF_ROWS = [{
    id: 20, trade_date: "2026-11-15", publish_date: "2026-11-15",
    model: "<img src=x onerror=alert(1)>", prompt_version: "v2.2", status: "published",
    validation_log: [],
    body_th: "", body_json: { sections: [{ heading: "<b>หัวข้อ</b>", sentences: [{ text: "<script>window.__pwned=1<\/script>", facts: [] }] }] }
  }];
  $("#briefRefreshBtn").click();
  await flush();
  assert.strictEqual(briefQueries.length, 2, "ปุ่มโหลดใหม่ยิง query อีกครั้ง");
  assert.strictEqual(w.__pwned, undefined, "สคริปต์ในเนื้อหาต้องไม่รัน");
  assert.strictEqual($("#briefBody").querySelector("script"), null, "ไม่มี <script> ถูกสร้างจากเนื้อหา");
  assert.ok(/<script>/.test(txt("#briefBody")), "ข้อความถูกแสดงเป็นตัวอักษรตามที่โมเดลเขียน");
  assert.strictEqual($("#briefBody").querySelector("b"), null, "แท็กในหัวข้อก็ถูก escape");
  assert.strictEqual($("#briefMeta").querySelector("img"), null, "ชื่อโมเดลก็ถูก escape");
  console.log("[ok] escape: เนื้อหา หัวข้อ และชื่อโมเดลจาก daily_brief ถูกแสดงเป็นข้อความ ไม่ใช่ HTML");

  // =====================================================================
  // 6 · ยังไม่มีบทสรุป / โหลดไม่สำเร็จ
  // =====================================================================
  BRIEF_ROWS = [];
  $("#briefRefreshBtn").click();
  await flush();
  assert.ok(/ยังไม่มีบทสรุป/.test(txt("#briefAsOf")), "ตารางว่างต้องบอกว่าว่าง");
  assert.ok(/ยังไม่มีข้อมูล/.test(txt("#briefHistoryTable")), "ประวัติว่างก็บอก");
  assert.strictEqual(hidden("#briefError"), true, "ว่างไม่ใช่ error");

  BRIEF_ROWS = [PUBLISHED];
  $("#briefRefreshBtn").click();
  await flush();
  assert.ok(/SPY \+0\.42%/.test(txt("#briefBody")), "กลับมามีข้อมูลก็แสดงได้");

  briefError = "JWT expired";
  $("#briefRefreshBtn").click();
  await flush();
  assert.strictEqual(hidden("#briefError"), false, "โหลดไม่สำเร็จต้องขึ้นข้อความ");
  assert.ok(/JWT expired/.test(txt("#briefError")), "บอกเหตุที่แท้จริง");
  assert.ok(/SPY \+0\.42%/.test(txt("#briefBody")), "ของเดิมบนจอไม่ถูกล้างเพราะโหลดรอบใหม่พลาด");
  assert.strictEqual(hidden("#briefLoading"), true, "สปินเนอร์ต้องหยุดแม้พลาด");
  briefError = null;
  console.log("[ok] ว่าง vs พลาด: แยกข้อความกัน และความพลาดไม่ล้างฉบับที่อ่านอยู่");

  console.log("\nALL BRIEF TAB TESTS PASSED");
}

main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
