#!/usr/bin/env node
/**
 * พิสูจน์ว่า tools/edge-share.js ทำงาน — โดยไม่แตะฐานข้อมูลจริง
 *
 * edge-share.js เป็นคำสั่งตรวจของมติ 40 มันต้องล็อกอินและต้องมีเน็ต จึงรันใน
 * CI ไม่ได้ และเครื่องมือที่รันไม่ได้ในที่ที่ตรวจได้ คือเครื่องมือที่พังเงียบ ๆ
 * ไฟล์นี้อุดช่องนั้น: ยกเซิร์ฟเวอร์ REST ปลอมขึ้นมาในเครื่อง ป้อนข้อมูลที่
 * กำหนดเองทั้งหมด แล้วรัน edge-share.js จริงใส่มัน
 *
 * สิ่งที่ไฟล์นี้พิสูจน์
 *   1. ชั้นนับ (countEdge) นับถูก — ตรวจตรงด้วย rotationData ที่เขียนมือ
 *   5. เซิร์ฟเวอร์ที่ไม่สนใจ offset/limit ทำให้เครื่องมือดังทันที ไม่ค้าง (บั๊ก 24 พ.ย.)
 *   2. ทั้งเส้นเดินจบ: ล็อกอิน -> QD.init -> bootDashboard -> เปลี่ยน
 *      <select> -> runMomentumCalculate -> อ่าน rotationData -> พิมพ์ตาราง
 *   3. ตัวเลขที่ออกมาจากข้อมูลชุดเดิมไม่เปลี่ยน (golden pin)
 *   4. ค่า default ที่หน้าเว็บเลือกเอง ถูกใช้จริง: benchmark = SPY และ
 *      จำนวนงวดราคาที่ดึง = 69 (เดือน) / 286 (สัปดาห์) ตามสูตรใน app.js
 *
 * สิ่งที่ไฟล์นี้ไม่พิสูจน์: ตัวเลขจากข้อมูลจริง — นั่นคืองานของการรันจริง
 *
 * พิสูจน์ว่าแดงได้: tests/mutate_edge_share.js
 *
 *   node tests/harness_edge_share.js
 */
"use strict";

const assert = require("assert");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
// QD_EDGE_TOOL ให้ tests/mutate_edge_share.js ชี้ไปสำเนาที่ถูกดัดแปลง
// (ต้องอยู่ในโฟลเดอร์ tools/ เหมือนกัน เพราะไฟล์นั้น require ../tests/_page.js)
const TOOL = path.resolve(ROOT, process.env.QD_EDGE_TOOL || path.join("tools", "edge-share.js"));
// เพดานเวลาของลูกหนึ่งตัว · รอบปกติใช้ไม่ถึง 10 วินาที ตั้ง 90 ให้เผื่อเครื่องช้า
const CHILD_TIMEOUT_MS = Number(process.env.QD_CHILD_TIMEOUT_MS || 90000);
const { countEdge } = require(TOOL);

let checks = 0;
function ok(msg) { checks++; console.log("[ok] " + msg); }

// ===========================================================================
// 1. ชั้นนับ — ตรวจตรง ไม่ผ่านเซิร์ฟเวอร์
// ===========================================================================
{
  const rd = {
    results: [
      { ticker: "AAA", points: [{ edge: "Core" }, { edge: "Edge" }], history: [{ edge: "Edge" }, { edge: "Core" }, { edge: "Edge" }] },
      { ticker: "BBB", points: [{ edge: "Core" }], history: [{ edge: "Core" }, { edge: "Core" }] },
      { ticker: "CCC", points: [{ edge: null }], history: [{ edge: null }] },
      { ticker: "DDD", points: [], history: [] }
    ]
  };
  const c = countEdge(rd);
  assert.strictEqual(c.instruments, 4, "นับทุกกองที่ engine คืนมา รวมกองที่ไม่มีจุด");
  assert.strictEqual(c.withPoint, 3, "DDD ไม่มีจุดเลย จึงไม่ถูกนับเป็นวาดได้");
  assert.strictEqual(c.currentEdge, 1, "จุดล่าสุดของ AAA เป็น Edge — ไม่ใช่จุดแรก");
  assert.strictEqual(c.currentCore, 1);
  assert.strictEqual(c.currentUnlabelled, 1, "CCC มีจุดแต่ยังไม่มีป้าย Core/Edge");
  assert.deepStrictEqual(c.edgeTickers, ["AAA"]);
  assert.strictEqual(c.historyPoints, 5, "จุดที่ edge เป็น null ไม่เข้าตัวหารของทั้งหน้าต่าง");
  assert.strictEqual(c.historyEdge, 2);
  ok("countEdge: อ่านจุดล่าสุด ไม่ใช่จุดแรก · ไม่นับจุดที่ไม่มีป้าย · แยกกองที่ไม่มีจุดออก");
}

// ===========================================================================
// 2-4. ทั้งเส้น ใส่เซิร์ฟเวอร์ปลอม
// ===========================================================================

// ข้อมูลกำหนดเอง: SPY เป็น benchmark + 11 กอง us_sector + 3 กอง thematic
// ราคาเดินด้วย LCG ที่ seed จาก id จึงได้ตัวเลขเดิมทุกครั้ง ไม่มี Math.random
const INSTRUMENTS = [{ id: 1, ticker: "SPY", name: "bench", category: "broad_market" }];
for (let i = 0; i < 11; i++) INSTRUMENTS.push({ id: 100 + i, ticker: "S" + (i + 1), name: "sector " + (i + 1), category: "us_sector" });
// thematic ต้องมีสมาชิกมากพอให้ "ราคาทั้งชุด" ทะลุ 4,000 แถว (30 กอง + SPY × 160 งวด
// = 4,960) ไม่งั้นลูปแบ่งหน้าใน app.js จะจบที่หน้าแรกเสมอ และด่านนี้จะไม่เคยเห็น
// หน้าที่สองเลย — ซึ่งเป็นช่องที่ทำให้บั๊ก 24 พ.ย. หลุดออกไปถึงมือ Peat
const THEMATIC_N = 30;
for (let i = 0; i < THEMATIC_N; i++) INSTRUMENTS.push({ id: 200 + i, ticker: "T" + (i + 1), name: "theme " + (i + 1), category: "thematic" });
// T4 มีราคาแค่ 3 งวด: อยู่ในรายชื่อ universe แต่สั้นเกินกว่าจะมีจุด RRG
// มีไว้เพื่อให้ "จำนวนสมาชิก" กับ "จำนวนที่วาดได้" ไม่เท่ากัน — ไม่งั้นการหาร
// ด้วยตัวหารผิดจะมองไม่ออกเลยในข้อมูลสังเคราะห์
// ต้องมีทั้งใน us_sector (ซึ่ง Edge > 0) และ thematic (ซึ่ง Edge = 0) เพราะถ้า
// กองที่วาดไม่ได้ไปอยู่แต่ใน universe ที่ Edge = 0 ตัวหารผิดก็ยังให้ 0%
// เหมือนกัน และการตรวจก็ไม่มีฟัน (เจอตอนรัน mutate_edge_share.js รอบแรก)
INSTRUMENTS.push({ id: 299, ticker: "TNEW", name: "theme newly listed", category: "thematic" });
INSTRUMENTS.push({ id: 111, ticker: "S12", name: "sector newly listed", category: "us_sector" });
const SHORT_HISTORY = new Set([299, 111]);

const PERIODS = { month: 160, week: 460, day: 1000 };

function closesFor(id, granularity) {
  // LCG: ตัวเลขชุดเดียวกันทุกครั้ง และต่าง instrument ต่างเส้นทาง
  let s = (id * 7919 + (granularity === "day" ? 11 : granularity === "week" ? 23 : 37)) % 2147483647;
  const next = () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
  const n = SHORT_HISTORY.has(id) ? 3 : PERIODS[granularity];
  const out = [];
  let price = 100;
  // วันที่เดินถอยหลังจาก 2026-11-20 ด้วยระยะห่างต่อ granularity
  const stepDays = granularity === "day" ? 1 : granularity === "week" ? 7 : 30;
  const end = Date.UTC(2026, 10, 20);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end - i * stepDays * 86400000);
    price *= 1 + (next() - 0.5) * 0.03 + (id === 1 ? 0.0004 : 0.0004 + ((id % 7) - 3) * 0.0002);
    out.push({ period_end: d.toISOString().slice(0, 10), adj_close: Math.round(price * 10000) / 10000 });
  }
  return out;
}

const seen = { paths: [], pages: [] };
// สวิตช์จำลอง "เซิร์ฟเวอร์ไม่สนใจการแบ่งหน้า" ซึ่งคือสภาพจริงของบั๊ก 24 พ.ย.
let ignorePaging = false;

// 🔴 แบ่งหน้าแบบ PostgREST จริง: อ่าน `offset` และ `limit` จาก **query string**
//
// ฉบับแรกของไฟล์นี้อ่าน HTTP header `Range` ตามที่ผมเข้าใจผิด · เซิร์ฟเวอร์ปลอม
// จึงยืนยันความเข้าใจผิดอันเดียวกับที่อยู่ในเครื่องมือ แทนที่จะหักล้างมัน
// ผลคือด่านเขียวสนิทแต่ของจริงวนไม่รู้จบที่ชุดแรกที่เกิน 4,000 แถว (24 พ.ย.)
//
// **ของปลอมต้องเลียนแบบของจริง ไม่ใช่เลียนแบบสิ่งที่เราเชื่อว่าของจริงทำ** —
// ที่มาของพฤติกรรมนี้คือ `range()` ใน `vendor/supabase.js` ซึ่งอยู่ใน repo ให้เปิดอ่านได้
function paginate(rows, url) {
  const off = url.searchParams.get("offset");
  const lim = url.searchParams.get("limit");
  if (off == null && lim == null) return rows;          // ไม่ขอแบ่งหน้า = ส่งทั้งหมด
  seen.pages.push([Number(off || 0), Number(lim || 0)]);
  if (ignorePaging) return rows;                        // แกล้งไม่สนใจ (ดูกลุ่มทดสอบท้ายไฟล์)
  const from = Number(off || 0);
  return rows.slice(from, from + Number(lim || rows.length));
}

function body(req) {
  return new Promise((res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => res(b));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (obj, code) => {
    const text = JSON.stringify(obj);
    res.writeHead(code || 200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
    res.end(text);
  };
  seen.paths.push(url.pathname);

  if (url.pathname === "/auth/v1/token") {
    const b = JSON.parse(await body(req) || "{}");
    if (b.password !== "harness-pass") return send({ error: "bad creds" }, 400);
    return send({ access_token: "harness-token", user: { email: b.email } });
  }

  if (url.pathname === "/rest/v1/instruments") {
    assert.ok(req.headers.authorization === "Bearer harness-token", "เครื่องมือต้องส่ง token ของ session ไม่ใช่ anon key");
    return send(INSTRUMENTS);
  }

  if (url.pathname === "/rest/v1/rpc/universe_tickers") {
    const b = JSON.parse(await body(req) || "{}");
    // broad_market = SPY เท่านั้น → วาดได้ 0 กอง (ทดสอบเคสว่าง)
    if (b.p_universe === "broad_market") return send([{ ticker: "SPY" }]);
    // asset_class = SPY + 4 กอง → วาดได้ 4 กอง ซึ่งต่ำกว่า SMALL_UNIVERSE_N (10)
    // ใช้ทดสอบกฎ "กลุ่มเล็กรายงานเป็นจำนวน ไม่ตีเป็น % และไม่ขึ้นธง" ของมติ 46 ·
    // ยืมกอง S1-S4 มาใช้ซ้ำ ไม่แตะ INSTRUMENTS และไม่แตะราคา จึงไม่ขยับค่า GOLDEN ของชุดอื่น
    // (หน้าเว็บมี universe ให้เลือกแค่ 4 ชื่อ จึงต้องใช้ชื่อจริง ไม่ตั้งชื่อใหม่)
    if (b.p_universe === "asset_class") {
      return send([{ ticker: "SPY" }, { ticker: "S1" }, { ticker: "S2" }, { ticker: "S3" }, { ticker: "S4" }]);
    }
    return send([]);
  }

  if (url.pathname === "/rest/v1/rpc/period_end_closes") {
    const b = JSON.parse(await body(req) || "{}");
    const ids = b.p_instrument_ids || [];
    const g = b.p_granularity;
    let rows = [];
    ids.forEach((id) => {
      closesFor(id, g).forEach((p) => {
        if (b.p_start_date && p.period_end < b.p_start_date) return;
        rows.push({ instrument_id: id, period_end: p.period_end, adj_close: p.adj_close });
      });
    });
    return send(paginate(rows, url));
  }

  if (url.pathname === "/rest/v1/rpc/period_volume_series") {
    const b = JSON.parse(await body(req) || "{}");
    const rows = [];
    (b.p_instrument_ids || []).forEach((id) => {
      closesFor(id, b.p_granularity).forEach((p) => {
        if (b.p_start_date && p.period_end < b.p_start_date) return;
        rows.push({ instrument_id: id, period_end: p.period_end, volume: 1000 + (id % 7) });
      });
    });
    return send(paginate(rows, url));
  }

  // ที่เหลือ (overview, heat calendar, breadth, risk, events, brief)
  // ตอบว่างให้หน้าเว็บ degrade ตามที่มันออกแบบไว้
  return send([]);
});

// ต้องเป็น spawn แบบไม่บล็อก ไม่ใช่ execFileSync: เซิร์ฟเวอร์ปลอมอยู่ใน
// event loop เดียวกัน ถ้ารอลูกแบบ sync มันจะตอบ REST ไม่ได้และค้างทั้งคู่
// (เจอจริงรอบแรกที่เขียนไฟล์นี้ — ค้าง 5 นาทีโดยไม่มีอะไรบอก)
function run(args, envOverride) {
  const port = server.address().port;
  const env = Object.assign({}, process.env, {
    QD_REST_BASE: "http://127.0.0.1:" + port,
    QD_REST_KEY: "harness-key",
    QD_EMAIL: "harness@example.com",
    QD_PASSWORD: "harness-pass"
  }, envOverride || {});
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL].concat(args), { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", timedOut = false;
    // 🔴 ต้องมี timeout — mutant ที่ถอดด่านกันวนไม่รู้จบออก ทำให้ลูกวนตลอดกาลจริง ๆ
    // ฉบับแรกไม่มี แล้ว harness ก็นั่งรอไปเรื่อย ๆ · บนเครื่องที่ RAM น้อยมันจบเพราะ
    // หน่วยความจำเต็ม แต่บนเครื่องที่ RAM เยอะมันค้างยาว (เจอจริงบนเครื่อง Peat 24 พ.ย.)
    // "จับได้เพราะหน่วยความจำเต็ม" ไม่ใช่ด่าน มันคือความบังเอิญที่ขึ้นกับเครื่อง
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, CHILD_TIMEOUT_MS);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        err += "\n[harness] ลูกไม่จบใน " + (CHILD_TIMEOUT_MS / 1000) + " วินาที จึงถูกฆ่า — ถือว่าล้มเหลว";
        resolve({ code: 124, out, err });
        return;
      }
      resolve({ code, out, err });
    });
  });
}

function must(r, what) {
  if (r.code !== 0) {
    console.error(r.out); console.error(r.err);
    throw new Error(what + ": เครื่องมือออกด้วยรหัส " + r.code);
  }
  return r.out;
}

async function main() {
  const out = must(await run(["--json", "--timeframe=month,week", "--universe=us_sector,thematic"]), "รอบหลัก");

  // ---- เส้นทางเดินจบ ----
  assert.ok(/ล็อกอิน  : ผ่าน/.test(out), "ต้องล็อกอินผ่านเซิร์ฟเวอร์ปลอมได้");
  assert.ok(seen.paths.includes("/auth/v1/token"), "ต้องเรียก endpoint ล็อกอินจริง");
  assert.ok(seen.paths.includes("/rest/v1/instruments"), "ต้องโหลด instruments จาก REST");
  assert.ok(seen.paths.filter((p) => p === "/rest/v1/rpc/period_end_closes").length >= 4,
    "4 ชุด (2 กรอบเวลา x 2 universe) ต้องดึงราคาอย่างน้อย 4 ครั้ง");
  assert.ok(seen.pages.length > 0, "ต้องขอแบ่งหน้าด้วย offset/limit ใน query string ไม่ใช่ header Range");
  assert.ok(seen.pages.some((p) => p[1] === 4000), "หน้าแรกต้องขอ limit = 4000 เท่ากับที่ app.js ตั้งไว้");
  assert.ok(seen.pages.some((p) => p[0] === 4000),
    "ต้องมีการขอ **หน้าที่สอง** (offset 4000) จริง — ถ้าไม่มี แปลว่าชุดข้อมูลทดสอบเล็กเกินกว่าจะเดินเส้นทางแบ่งหน้า และบั๊กแบบ 24 พ.ย. จะหลุดอีก");
  ok("เส้นทางเต็ม: ล็อกอิน -> init -> bootDashboard -> runMomentumCalculate -> ตาราง");

  const json = JSON.parse(out.slice(out.indexOf("\n{") + 1));
  assert.strictEqual(json.rows.length, 4, "ต้องได้ผล 4 ชุด");

  // ---- ค่า default มาจาก app.js จริง ----
  assert.ok(/benchmark ที่หน้าเว็บเลือกเอง : SPY/.test(out), "หน้าเว็บต้องเลือก SPY เป็น benchmark เอง");
  const byKey = {};
  json.rows.forEach((r) => { byKey[r.timeframe + "/" + r.universe] = r; });
  assert.strictEqual(byKey["month/us_sector"].pricePeriodsFetched, 69,
    "เดือน: 2*12 + 2*8 + 24 + 5 = 69 งวด ตามสูตรใน app.js");
  assert.strictEqual(byKey["week/us_sector"].pricePeriodsFetched, 286,
    "สัปดาห์: 2*52 + 2*36 + 105 + 5 = 286 งวด");
  assert.strictEqual(byKey["month/us_sector"].m, 12, "lookback เดือนต้องเป็น 12 ตาม default");
  assert.strictEqual(byKey["week/us_sector"].m, 52, "lookback สัปดาห์ต้องเป็น 52 ตาม default");
  assert.strictEqual(byKey["month/us_sector"].k, 8, "k = max(2, round(12*0.7)) = 8");
  json.rows.forEach((r) => {
    assert.strictEqual(r.needsRefetch, false, r.timeframe + "/" + r.universe + ": โหลดแล้วต้องไม่ค้างว่าต้องโหลดอีก");
    assert.strictEqual(r.error, "", r.timeframe + "/" + r.universe + ": ต้องไม่มี error บนหน้าเว็บ");
  });
  ok("ใช้ค่า default ของหน้าเว็บจริง: SPY · lookback 12/52 · k=8 · หน้าต่างราคา 69/286 งวด");

  // ---- สมาชิกถูกตัวและ benchmark ไม่ถูกวาด ----
  assert.strictEqual(byKey["month/us_sector"].members, 12, "us_sector ต้องได้ 12 กองจาก category (รวม S12 ที่ประวัติสั้น)");
  assert.strictEqual(byKey["month/thematic"].members, THEMATIC_N + 1, "thematic ต้องได้ " + (THEMATIC_N + 1) + " กองจาก category (รวม TNEW ที่ประวัติสั้น)");
  assert.strictEqual(byKey["month/us_sector"].plotted, 11, "S12 มีราคา 3 งวด จึงไม่มีจุด RRG");
  assert.strictEqual(byKey["month/thematic"].plotted, THEMATIC_N, "TNEW มีราคา 3 งวด จึงไม่มีจุด RRG");
  assert.ok(byKey["month/us_sector"].edgeTickers.every((t) => t !== "SPY"), "benchmark ต้องไม่อยู่ในกองที่ถูกวาด");
  ok("resolve universe ด้วยโค้ดหน้าเว็บ: us_sector 12 (วาดได้ 11) · thematic " + (THEMATIC_N + 1) + " (วาดได้ " + THEMATIC_N + ") · benchmark ไม่ถูกวาด");

  // ---- ตัวหารของสัดส่วนต้องเป็น "กองที่วาดได้" ไม่ใช่ "กองในรายชื่อ" ----
  json.rows.forEach((r) => {
    if (r.plotted === 0) return;
    const expected = 100 * r.currentEdge / r.plotted;
    assert.ok(Math.abs(r.currentEdgePct - expected) < 1e-9,
      r.timeframe + "/" + r.universe + ": สัดส่วนต้องหารด้วยกองที่วาดได้ (" + r.plotted +
      ") ไม่ใช่กองในรายชื่อ (" + r.members + ") — ได้ " + r.currentEdgePct);
  });
  // การตรวจข้างบนมีฟันเฉพาะเมื่อมีแถวที่ "วาดได้ != สมาชิก" และ "Edge > 0"
  // ด้วย ไม่งั้นสองตัวหารให้ 0% เหมือนกันทั้งคู่ — บังคับให้เคสนั้นมีอยู่จริง
  const discriminating = json.rows.filter((r) => r.plotted !== r.members && r.currentEdge > 0);
  assert.ok(discriminating.length > 0,
    "ข้อมูลสังเคราะห์ต้องมีอย่างน้อยหนึ่งชุดที่กองวาดไม่ได้ปนอยู่กับ Edge > 0 ไม่งั้นตัวหารผิดก็ยังผ่าน");
  ok("สัดส่วนหารด้วยจำนวนกองที่วาดได้ ไม่ใช่จำนวนกองในรายชื่อ (" + discriminating.length + " ชุดที่แยกสองตัวหารออกจากกันได้)");

  // ---- golden pin: ข้อมูลชุดเดิมต้องให้ตัวเลขเดิม ----
  // จับค่าจาก app.js md5 3647dd95ea63b32cc61c429f99d20788 (23 พ.ย. 2026)
  const GOLDEN = {
    "month/us_sector": { currentEdge: 4, currentCore: 7, historyPoints: 264, historyEdge: 99, nSteps: 253, rsEdge: 0.3693633606312403, momEdge: 0.36724392520457627 },
    "month/thematic": { currentEdge: 11, currentCore: 19, historyPoints: 720, historyEdge: 246, nSteps: 690, rsEdge: 0.31752218818570555, momEdge: 0.3269277947615308 },
    "week/us_sector": { currentEdge: 3, currentCore: 8, historyPoints: 1133, historyEdge: 85, nSteps: 1122, rsEdge: 0.21799529359890357, momEdge: 0.1850263073184948 },
    "week/thematic": { currentEdge: 2, currentCore: 28, historyPoints: 3090, historyEdge: 337, nSteps: 3060, rsEdge: 0.18417267338269028, momEdge: 0.1890526404081072 }
  };
  // QD_CAPTURE=1 พิมพ์ค่าที่วัดได้ให้เอาไปแปะเป็น GOLDEN ชุดใหม่ ตอนที่
  // "ตั้งใจ" เปลี่ยนข้อมูลสังเคราะห์ด้านบน — มันพิมพ์เพิ่ม ไม่ได้ข้ามการตรวจ
  // เพราะด่านที่ปิดตัวเองได้ด้วย environment variable คือด่านที่เขียว
  // ทั้งที่ไม่ได้เฝ้าอะไร
  if (process.env.QD_CAPTURE) {
    const cap = {};
    Object.keys(byKey).forEach((k) => {
      const r = byKey[k];
      cap[k] = { currentEdge: r.currentEdge, currentCore: r.currentCore, historyPoints: r.historyPoints, historyEdge: r.historyEdge, nSteps: r.nSteps, rsEdge: r.rsEdge, momEdge: r.momEdge };
    });
    console.log("CAPTURE " + JSON.stringify(cap));
  }
  Object.keys(GOLDEN).forEach((k) => {
    const g = GOLDEN[k], r = byKey[k];
    assert.ok(r, "ขาดผลของ " + k);
    ["currentEdge", "currentCore", "historyPoints", "historyEdge", "nSteps"].forEach((f) => {
      assert.strictEqual(r[f], g[f], k + "." + f + ": ได้ " + r[f] + " ควรเป็น " + g[f]);
    });
    assert.ok(Math.abs(r.rsEdge - g.rsEdge) < 1e-9, k + ".rsEdge เปลี่ยนไปจากค่าที่ตรึงไว้: " + r.rsEdge);
    assert.ok(Math.abs(r.momEdge - g.momEdge) < 1e-9, k + ".momEdge เปลี่ยนไปจากค่าที่ตรึงไว้: " + r.momEdge);
  });
  ok("golden pin: ข้อมูลชุดเดิมให้ Edge/Core/nSteps/เกณฑ์ ตัวเลขเดิมทุกตัว");

  // ---- ตารางและคำตัดสินถูกพิมพ์ออกมา ----
  assert.ok(/สัดส่วน Edge แยก Universe/.test(out), "ต้องพิมพ์หัวตาราง");
  assert.ok(/เกณฑ์มติ 46/.test(out), "ต้องเทียบกับเกณฑ์ของมติ 46");
  assert.ok(/ป้าย Core\/Edge เลิกแยกแยะ/.test(out), "ต้องบอกว่าธงนี้เฝ้าอะไร ไม่ใช่พิมพ์เลขเปล่า");
  // นับธงที่ "ควรได้" จากข้อมูลดิบเอง — คำนวณซ้ำด้วยมือที่นี่ ไม่หยิบ r.flagged
  // ที่เครื่องมือคำนวณมา เพราะนั่นคือการให้จำเลยเป็นพยานให้ตัวเอง ·
  // และไม่ใช้ regex \\d+ เพราะมันผ่านได้แม้ตัวนับธงไม่ทำงานเลย (mutant E9 เคยหลุดเพราะเหตุนี้)
  const shouldFlag = (r) => {
    if (r.error) return true;
    if (r.plotted === 0) return true;
    if (r.plotted < 10) return false;                       // กลุ่มเล็ก ไม่ตัดสิน
    if (r.historyEdgePct == null) return false;
    return r.historyEdgePct >= 70 || r.historyEdgePct === 0; // ป้ายแปะหมด หรือไม่เคยแปะ
  };
  json.rows.forEach((r) => {
    assert.strictEqual(r.flagged, shouldFlag(r),
      r.timeframe + "/" + r.universe + ": ธงของเครื่องมือ (" + r.flagged +
      ") ไม่ตรงกับที่คำนวณจากข้อมูลดิบ (" + shouldFlag(r) + ") · หน้าต่าง = " + r.historyEdgePct + "%");
    assert.ok(typeof r.verdict === "string" && r.verdict, r.timeframe + "/" + r.universe + ": ต้องมีเหตุผลคำตัดสินใน JSON");
  });
  const expectedFlags = json.rows.filter(shouldFlag).length;
  assert.ok(out.includes("ธงเตือนทั้งหมด: " + expectedFlags + " จาก 4 ชุด"),
    "ต้องรายงานธงเตือน " + expectedFlags + " จาก 4 — ได้: " + (/ธงเตือนทั้งหมด:.*/.exec(out) || ["(ไม่พบบรรทัด)"])[0]);
  ok("พิมพ์ตาราง เกณฑ์มติ 46 และนับธงเตือนได้ตรง (" + expectedFlags + " จาก 4) · JSON มีเหตุผลคำตัดสินทุกแถว");

  // ---- universe ว่างต้องไม่เงียบ ----
  const out2 = must(await run(["--timeframe=month", "--universe=broad_market"]), "รอบ universe ว่าง");
  assert.ok(/สมาชิก 1 /.test(out2), "broad_market ในชุดนี้มีแต่ SPY");
  assert.ok(/วาดได้ 0/.test(out2), "SPY เป็น benchmark จึงไม่ถูกวาด เหลือ 0 กอง");
  assert.ok(/ไม่มีจุดให้นับ/.test(out2), "0 กองต้องขึ้นธงเตือน ไม่ใช่รายงาน 0% เงียบ ๆ");
  assert.ok(out2.includes("ธงเตือนทั้งหมด: 1 จาก 1 ชุด"),
    "0 กองต้องถูกนับเป็นธงเตือนจริง ไม่ใช่แค่พิมพ์คำว่าไม่มีจุดให้นับ — ได้: " +
    (/ธงเตือนทั้งหมด:.*/.exec(out2) || ["(ไม่พบบรรทัด)"])[0]);
  ok("universe ที่เหลือ 0 กองหลังตัด benchmark ขึ้นธงเตือนจริง (1 จาก 1)");

  // ---- กลุ่มเล็ก (< 10 กอง) ต้องรายงานเป็นจำนวน ไม่ตีเป็น % และไม่ขึ้นธง ----
  // มติ 46: 4 กองมีค่าได้แค่ 0/25/50/75/100% ไม่มีค่าไหนตกในช่วงที่ calibrate ไว้
  // การพิมพ์ % จึงหลอกตา และการตัดสินด้วย % จึงดังหรือเงียบด้วยเหตุผลที่ไม่เกี่ยวกับป้าย
  const outSmall = must(await run(["--json", "--timeframe=month", "--universe=asset_class"]), "รอบกลุ่มเล็ก");
  const jsonSmall = JSON.parse(outSmall.slice(outSmall.indexOf("{\n")));
  const rs = jsonSmall.rows[0];
  assert.strictEqual(rs.members, 5, "asset_class ต้องได้ 5 กองจาก universe_tickers (รวม SPY)");
  assert.strictEqual(rs.plotted, 4, "ตัด SPY ที่เป็น benchmark ออก เหลือ 4 กอง");
  assert.strictEqual(rs.verdict, "small_universe",
    "4 กองต้องถูกตัดสินเป็น small_universe — ได้: " + rs.verdict);
  assert.strictEqual(rs.flagged, false, "กลุ่มเล็กต้องไม่ขึ้นธง แม้สัดส่วนจะสุดขอบ");
  assert.ok(outSmall.includes("ธงเตือนทั้งหมด: 0 จาก 1 ชุด"),
    "กลุ่มเล็กต้องได้ธง 0 — ได้: " + (/ธงเตือนทั้งหมด:.*/.exec(outSmall) || ["(ไม่พบบรรทัด)"])[0]);
  assert.ok(/กลุ่มเล็ก — รายงานเป็นจำนวน/.test(outSmall), "ต้องบอกคนอ่านว่าทำไมไม่ตัดสิน");
  // ช่องสัดส่วนต้องเป็น n/N ไม่ใช่ % — ดูบรรทัดตารางของแถวนี้
  const smallLine = outSmall.split("\n").filter((l) => /^month\s+asset_class/.test(l))[0] || "";
  assert.ok(smallLine, "ต้องมีบรรทัดตารางของ month/asset_class");
  // ต้องมีประวัติให้ตัดสินจริง ๆ แล้วเราเลือกไม่ตัดสินเพราะกลุ่มเล็ก —
  // ไม่ใช่ผ่านเพราะไม่มีอะไรให้ตัดสินตั้งแต่แรก (เคสนั้นคือ no_history ซึ่งคนละเรื่อง)
  assert.ok(rs.historyPoints > 0, "กลุ่มเล็กชุดนี้ต้องมีจุดในประวัติ ไม่งั้นเทสต์ไม่ได้ทดสอบกฎกลุ่มเล็ก");
  assert.ok(new RegExp("\\s" + rs.historyEdge + "/" + rs.historyPoints + "\\s").test(smallLine),
    "ช่องสัดส่วนตลอดหน้าต่างของกลุ่มเล็กต้องพิมพ์เป็นจำนวน " + rs.historyEdge + "/" + rs.historyPoints +
    " — ได้: " + smallLine.trim());
  assert.ok(new RegExp(rs.currentEdge + "/4").test(smallLine),
    "ช่อง %Edge ของกลุ่มเล็กต้องพิมพ์เป็นจำนวน " + rs.currentEdge + "/4 — ได้: " + smallLine.trim());
  assert.ok(!/%/.test(smallLine), "บรรทัดตารางของกลุ่มเล็กต้องไม่มีเครื่องหมาย % เลย — ได้: " + smallLine.trim());
  ok("กลุ่มเล็ก 4 กอง: พิมพ์เป็นจำนวน " + rs.currentEdge + "/4 และ " + rs.historyEdge + "/" + rs.historyPoints + " ในหน้าต่าง ไม่มี % และไม่ขึ้นธง (0 จาก 1)");

  // ---- ยิงเกณฑ์มติ 46 ตรง ๆ ที่ฟังก์ชันล้วน ----
  // ด่านตรวจเป็นฟังก์ชันล้วนตามมติ 44 จึงยิงที่ขอบเกณฑ์ได้ตรง ๆ โดยไม่ต้อง
  // ปั้นข้อมูลราคาให้สัดส่วนไปตกตรงขอบพอดี (ซึ่งทำไม่ได้จริงด้วยข้อมูลสังเคราะห์)
  // require TOOL ไม่ใช่ path ตรง ๆ — ไม่งั้น mutate_edge_share.js ดัดแปลงสำเนา
  // แล้วกลุ่มนี้ยังยิงไฟล์ต้นฉบับที่ไม่ถูกแตะ ด่านก็เขียวทั้งที่เครื่องมือพัง
  const { judgeRow, LABEL_USELESS_HIGH, SMALL_UNIVERSE_N } = require(TOOL);
  assert.strictEqual(LABEL_USELESS_HIGH, 70, "ขอบ 'ป้ายแปะเกือบทุกกอง' ของมติ 46 คือ 70%");
  assert.strictEqual(SMALL_UNIVERSE_N, 10, "ขอบกลุ่มเล็กของมติ 46 คือ 10 กอง");
  const BOUNDS = [
    // [แถวผล, ควรขึ้นธง, เหตุผลที่ควรได้, คำอธิบายเคส]
    [{ plotted: 11, historyEdgePct: 35, error: "" }, false, "ok", "ฐานปกติรายเดือน 35% ต้องไม่ดัง"],
    [{ plotted: 11, historyEdgePct: 40, error: "" }, false, "ok", "40% คือค่าที่ฉบับแรกดังผิด — ต้องเงียบแล้ว"],
    [{ plotted: 11, historyEdgePct: 69.9, error: "" }, false, "ok", "ใต้ขอบ 70 ต้องไม่ดัง"],
    [{ plotted: 11, historyEdgePct: 70, error: "" }, true, "label_everywhere", "ที่ขอบ 70 พอดีต้องดัง"],
    [{ plotted: 11, historyEdgePct: 74, error: "" }, true, "label_everywhere", "74% คือ 40 จาก 54 ที่มติ 40 ยกเป็นตัวอย่าง"],
    [{ plotted: 11, historyEdgePct: 0, error: "" }, true, "label_never", "ป้ายไม่เคยขึ้นเลยต้องดัง"],
    [{ plotted: 11, historyEdgePct: 0.1, error: "" }, false, "ok", "ขึ้นบ้างแม้น้อยต้องไม่ดัง"],
    [{ plotted: 10, historyEdgePct: 0, error: "" }, true, "label_never", "10 กองไม่ใช่กลุ่มเล็ก ต้องตัดสิน"],
    [{ plotted: 9, historyEdgePct: 0, error: "" }, false, "small_universe", "9 กองเป็นกลุ่มเล็ก ไม่ตัดสิน"],
    [{ plotted: 5, historyEdgePct: 100, error: "" }, false, "small_universe", "กลุ่มเล็กต้องไม่ดังแม้ 100%"],
    [{ plotted: 0, historyEdgePct: null, error: "" }, true, "no_points", "ไม่มีจุดให้นับต้องดัง"],
    [{ plotted: 11, historyEdgePct: null, error: "" }, false, "no_history", "ยังไม่มีประวัติ ไม่ตัดสิน"],
    [{ plotted: 11, historyEdgePct: 35, error: "พัง" }, true, "error", "คำนวณไม่ผ่านต้องดังเสมอ"]
  ];
  BOUNDS.forEach(([row, flagged, reason, why]) => {
    const j = judgeRow(row);
    assert.strictEqual(j.flagged, flagged, why + " — ได้ flagged=" + j.flagged);
    assert.strictEqual(j.reason, reason, why + " — ได้ reason=" + j.reason);
  });
  // เคสที่ขอบต้องมีอยู่จริงทั้งสองฝั่ง ไม่ใช่ตารางที่เป็น false ล้วน (บทเรียน E9/E3)
  assert.ok(BOUNDS.some((b) => b[1]) && BOUNDS.some((b) => !b[1]), "ตารางขอบต้องมีทั้งเคสดังและเคสเงียบ");
  ok("ยิงเกณฑ์มติ 46 ที่ judgeRow ตรง ๆ " + BOUNDS.length + " เคส: ขอบ 70 / ศูนย์ / กลุ่มเล็ก / error ครบ");

  // ---- ไม่มีรหัสผ่าน ต้องไม่เดินต่อ ----
  const noCred = await run([], { QD_EMAIL: "", QD_PASSWORD: "" });
  assert.strictEqual(noCred.code, 2, "ไม่มี credential ต้องออกด้วยรหัส 2");
  assert.ok(/QD_EMAIL/.test(noCred.err), "ต้องบอกว่าต้องตั้ง environment variable อะไร");
  ok("ไม่มี QD_EMAIL/QD_PASSWORD ต้องหยุดด้วยรหัส 2 และบอกวิธี");

  // ---- เซิร์ฟเวอร์ไม่สนใจการแบ่งหน้า ต้องดังทันที ไม่ใช่ค้าง ----
  // นี่คือสภาพจริงของบั๊ก 24 พ.ย.: ขอ 4,000 แถวแล้วได้กลับมาทั้งชุด ลูปใน app.js
  // จึงไม่มีวันจบ · ด่านกันวนไม่รู้จบใน edge-share.js ต้องเปลี่ยนมันเป็น error ที่อ่านได้
  ignorePaging = true;
  // ต้องเลือกชุดที่ทะลุ 4,000 แถวจริง ไม่งั้นลูปจบที่หน้าแรกและด่านไม่มีโอกาสทำงาน
  // (month/thematic = 31 x 69 = 2,139 แถว ยังไม่ถึง · week/thematic = 31 x 286 ถึงแน่)
  const stuck = await run(["--timeframe=week", "--universe=thematic"]);
  ignorePaging = false;
  assert.notStrictEqual(stuck.code, 0, "ชุดที่คำนวณไม่ผ่านต้องทำให้ออกด้วยรหัสไม่เป็นศูนย์");
  assert.ok(/การแบ่งหน้าไม่ถูกนำไปใช้/.test(stuck.out + stuck.err),
    "ต้องบอกตรง ๆ ว่าการแบ่งหน้าไม่ถูกนำไปใช้ — ได้: " + (stuck.out + stuck.err).slice(-300));
  ok("เซิร์ฟเวอร์ที่ไม่สนใจ offset/limit ทำให้เครื่องมือดังทันที ไม่ค้าง");

  // ---- รหัสผ่านผิด ต้องดังไม่ใช่เดินต่อด้วย anon ----
  const badCred = await run([], { QD_PASSWORD: "ผิด" });
  assert.strictEqual(badCred.code, 1, "รหัสผ่านผิดต้องล้มเหลว");
  assert.ok(/ล็อกอินไม่ผ่าน/.test(badCred.err), "ต้องบอกว่าล็อกอินไม่ผ่าน");
  ok("รหัสผ่านผิดต้องหยุด ไม่ใช่เดินต่อด้วยสิทธิ์ anon");

  console.log("\nผ่านทั้งหมด " + checks + " กลุ่ม");
}

server.listen(0, "127.0.0.1", () => {
  main().then(
    () => server.close(),
    (e) => { server.close(); console.error("\nล้มเหลว: " + (e && e.stack ? e.stack : e)); process.exit(1); }
  );
});
