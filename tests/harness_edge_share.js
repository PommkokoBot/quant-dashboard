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
for (let i = 0; i < 3; i++) INSTRUMENTS.push({ id: 200 + i, ticker: "T" + (i + 1), name: "theme " + (i + 1), category: "thematic" });
// T4 มีราคาแค่ 3 งวด: อยู่ในรายชื่อ universe แต่สั้นเกินกว่าจะมีจุด RRG
// มีไว้เพื่อให้ "จำนวนสมาชิก" กับ "จำนวนที่วาดได้" ไม่เท่ากัน — ไม่งั้นการหาร
// ด้วยตัวหารผิดจะมองไม่ออกเลยในข้อมูลสังเคราะห์
// ต้องมีทั้งใน us_sector (ซึ่ง Edge > 0) และ thematic (ซึ่ง Edge = 0) เพราะถ้า
// กองที่วาดไม่ได้ไปอยู่แต่ใน universe ที่ Edge = 0 ตัวหารผิดก็ยังให้ 0%
// เหมือนกัน และการตรวจก็ไม่มีฟัน (เจอตอนรัน mutate_edge_share.js รอบแรก)
INSTRUMENTS.push({ id: 203, ticker: "T4", name: "theme newly listed", category: "thematic" });
INSTRUMENTS.push({ id: 111, ticker: "S12", name: "sector newly listed", category: "us_sector" });
const SHORT_HISTORY = new Set([203, 111]);

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

const seen = { paths: [], ranges: [] };

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
    // broad_market = SPY เท่านั้น · asset_class = ไม่มีสมาชิก (ทดสอบเคสว่าง)
    if (b.p_universe === "broad_market") return send([{ ticker: "SPY" }]);
    if (b.p_universe === "asset_class") return send([{ ticker: "SPY" }]);
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
    // เลียนแบบ Range header ของ PostgREST เพื่อให้เส้นทางแบ่งหน้าได้ถูกเดิน
    const range = req.headers.range;
    if (range) {
      const [from, to] = String(range).split("-").map(Number);
      seen.ranges.push([from, to]);
      rows = rows.slice(from, to + 1);
    }
    return send(rows);
  }

  // ที่เหลือ (overview, heat calendar, breadth, risk, volume, events, brief)
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
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => resolve({ code, out, err }));
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
  assert.ok(seen.ranges.length > 0 && seen.ranges[0][1] - seen.ranges[0][0] === 3999,
    "ต้องส่ง Range header ขนาด 4000 แถวเหมือนที่หน้าเว็บส่ง");
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
  assert.strictEqual(byKey["month/thematic"].members, 4, "thematic ต้องได้ 4 กองจาก category (รวม T4 ที่ประวัติสั้น)");
  assert.strictEqual(byKey["month/us_sector"].plotted, 11, "S12 มีราคา 3 งวด จึงไม่มีจุด RRG");
  assert.strictEqual(byKey["month/thematic"].plotted, 3, "T4 มีราคา 3 งวด จึงไม่มีจุด RRG");
  assert.ok(byKey["month/us_sector"].edgeTickers.every((t) => t !== "SPY"), "benchmark ต้องไม่อยู่ในกองที่ถูกวาด");
  ok("resolve universe ด้วยโค้ดหน้าเว็บ: us_sector 12 (วาดได้ 11) · thematic 4 (วาดได้ 3) · benchmark ไม่ถูกวาด");

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
    "month/thematic": { currentEdge: 0, currentCore: 3, historyPoints: 72, historyEdge: 17, nSteps: 69, rsEdge: 0.2619293670813647, momEdge: 0.1996200061517186 },
    "week/us_sector": { currentEdge: 3, currentCore: 8, historyPoints: 1133, historyEdge: 85, nSteps: 1122, rsEdge: 0.21799860140089322, momEdge: 0.18502078271572486 },
    "week/thematic": { currentEdge: 0, currentCore: 3, historyPoints: 309, historyEdge: 56, nSteps: 306, rsEdge: 0.17555798617466678, momEdge: 0.13755428100401446 }
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
  assert.ok(/เกณฑ์ยอมรับของมติ 40/.test(out), "ต้องเทียบกับเกณฑ์ของมติ 40");
  // thematic สองกรอบเวลา Edge = 0 ทั้งคู่ (ต่ำกว่าขอบ 2%) จึงต้องได้ 2 ธง
  // นับตรง ๆ ไม่ใช่ \d+ เพราะ \d+ ผ่านได้แม้ตัวนับธงจะไม่ทำงานเลย
  const expectedFlags = json.rows.filter((r) => r.currentEdgePct == null || r.currentEdgePct < 2 || r.currentEdgePct > 40).length;
  assert.strictEqual(expectedFlags, 2, "ข้อมูลชุดนี้ต้องมี 2 ชุดที่เข้าเงื่อนไขธงเตือน");
  assert.ok(out.includes("ธงเตือนทั้งหมด: 2 จาก 4 ชุด"),
    "ต้องรายงานธงเตือน 2 จาก 4 — ได้: " + (/ธงเตือนทั้งหมด:.*/.exec(out) || ["(ไม่พบบรรทัด)"])[0]);
  ok("พิมพ์ตาราง เกณฑ์ และนับธงเตือนได้ตรง (2 จาก 4)");

  // ---- universe ว่างต้องไม่เงียบ ----
  const out2 = must(await run(["--timeframe=month", "--universe=asset_class"]), "รอบ universe ว่าง");
  assert.ok(/สมาชิก 1 /.test(out2), "asset_class ในชุดนี้มีแต่ SPY");
  assert.ok(/วาดได้ 0/.test(out2), "SPY เป็น benchmark จึงไม่ถูกวาด เหลือ 0 กอง");
  assert.ok(/ไม่มีจุดให้นับ/.test(out2), "0 กองต้องขึ้นธงเตือน ไม่ใช่รายงาน 0% เงียบ ๆ");
  assert.ok(out2.includes("ธงเตือนทั้งหมด: 1 จาก 1 ชุด"),
    "0 กองต้องถูกนับเป็นธงเตือนจริง ไม่ใช่แค่พิมพ์คำว่าไม่มีจุดให้นับ — ได้: " +
    (/ธงเตือนทั้งหมด:.*/.exec(out2) || ["(ไม่พบบรรทัด)"])[0]);
  ok("universe ที่เหลือ 0 กองหลังตัด benchmark ขึ้นธงเตือนจริง (1 จาก 1)");

  // ---- ไม่มีรหัสผ่าน ต้องไม่เดินต่อ ----
  const noCred = await run([], { QD_EMAIL: "", QD_PASSWORD: "" });
  assert.strictEqual(noCred.code, 2, "ไม่มี credential ต้องออกด้วยรหัส 2");
  assert.ok(/QD_EMAIL/.test(noCred.err), "ต้องบอกว่าต้องตั้ง environment variable อะไร");
  ok("ไม่มี QD_EMAIL/QD_PASSWORD ต้องหยุดด้วยรหัส 2 และบอกวิธี");

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
