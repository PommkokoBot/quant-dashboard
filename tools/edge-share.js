#!/usr/bin/env node
/**
 * วัดสัดส่วน Core/Edge แยก Universe × Timeframe จากข้อมูลจริง — คำสั่งตรวจของมติ 40
 *
 * ทำไมไฟล์นี้ไม่ใช่ไฟล์ .sql
 * -------------------------
 * มติ 40 บอกว่า "ปล่อยก่อน แล้วตรวจสัดส่วน Edge แยก Universe หลังปล่อย" และ
 * ตอนนั้นยังไม่ได้ระบุว่าจะตรวจด้วยอะไร พอมาถึงจุดที่ต้องเขียนจริง ปรากฏว่า
 * ฐานข้อมูลตรวจเรื่องนี้เองไม่ได้: ไฟล์ใน sql/ ทั้งชุดไม่มีคำว่า rotation /
 * quadrant / rs_ratio / edge แม้แต่คำเดียว เพราะ RRG ทั้งก้อน (RS-Ratio,
 * RS-Momentum, เกณฑ์ Edge) คำนวณใน JS ตามมติ 41 ถ้าเขียนเป็น SQL ก็คือสร้าง
 * สูตรชุดที่สองขึ้นมา ซึ่งมติ 44 ห้ามไว้ตรง ๆ และเป็นต้นเหตุเดิมของปัญหา
 * "คำนวณสองที่แล้วไม่ตรงกัน" ที่เพิ่งคุยกันรอบนี้
 *
 * ไฟล์นี้จึงเดินทางตรงข้าม: ไม่เขียนสูตรใหม่เลยแม้บรรทัดเดียว มันเปิดหน้าเว็บ
 * จริงใน jsdom เสียบ client ที่ต่อ REST ของ Supabase เข้าไปทาง QD.init()
 * แล้วกดปุ่ม "คำนวณ" ด้วยโค้ดของหน้าเว็บเอง (ตั้งค่า <select> แล้ว dispatch
 * change ให้ตัว handler ที่ผูกไว้จริงทำงาน) สิ่งที่ไฟล์นี้ทำมีแค่ "นับ" สิ่งที่
 * `state.momentum.rotationData` ตอบออกมา
 *
 * ผลพลอยได้ที่สำคัญกว่าตัวเลข: ค่า default ทุกตัว (lookback, SMA, tail,
 * benchmark = SPY, ขนาดหน้าต่างราคา) มาจาก app.js ทางเดียว ไม่มีสำเนาในนี้
 * ถ้าวันหนึ่งหน้าเว็บเปลี่ยน default ตัวเลขจากคำสั่งนี้จะเปลี่ยนตามเอง
 *
 * สิ่งที่ไฟล์นี้ "ไม่" พิสูจน์
 * -------------------------
 *   · ไม่พิสูจน์ว่าเกณฑ์ Edge ถูก — พิสูจน์แค่ว่ามันให้สัดส่วนเท่าไรในแต่ละ
 *     Universe ซึ่งเป็นข้อมูลให้คนตัดสิน ไม่ใช่คำตัดสิน
 *   · ไม่ใช่ชุดเทสต์ ไม่เข้า `npm test` และ CI รันไม่ได้ (ต้องมีเน็ตและต้อง
 *     ล็อกอิน) — ชุดเทสต์ของ engine คือ tests/test_rotation.js
 *
 * วิธีรัน
 * ------
 *   QD_EMAIL=... QD_PASSWORD=... node tools/edge-share.js
 *
 * ตาราง `instruments` เปิดให้อ่านเฉพาะ role `authenticated` (ตรวจ pg_policies
 * 23 พ.ย. 2026) จึงต้องล็อกอิน · รหัสผ่านอ่านจาก environment variable เท่านั้น
 * ไม่รับทาง argument และไม่ถูกพิมพ์ออกจอ
 *
 * ธงที่มีให้
 *   --json         พิมพ์ผลเป็น JSON ต่อท้ายตาราง (เอาไปเทียบรอบหน้าได้)
 *   --universe=x   วัดเฉพาะ universe นั้น (คั่นด้วย , ได้)
 *   --timeframe=x  วัดเฉพาะกรอบเวลานั้น (คั่นด้วย , ได้)
 *
 * QD_REST_BASE / QD_REST_KEY ใช้ชี้ไปเซิร์ฟเวอร์อื่นได้ มีไว้ให้
 * tests/harness_edge_share.js ทดสอบตัวไฟล์นี้โดยไม่ต้องแตะฐานข้อมูลจริง
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { loadPage } = require("../tests/_page.js");

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Config: อ่านจาก app.js ทางเดียว ไม่เก็บสำเนา
// ---------------------------------------------------------------------------
const APP_SRC = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function pickFromApp(re, what) {
  const m = re.exec(APP_SRC);
  if (!m) throw new Error(`อ่าน ${what} จาก app.js ไม่ได้ — รูปแบบในไฟล์เปลี่ยนไปแล้ว`);
  return m[1];
}

const BASE = (process.env.QD_REST_BASE || pickFromApp(/const SUPABASE_URL = "([^"]+)"/, "SUPABASE_URL")).replace(/\/+$/, "");
const KEY = process.env.QD_REST_KEY || pickFromApp(/const SUPABASE_ANON_KEY = "([^"]+)"/, "SUPABASE_ANON_KEY");

// ---------------------------------------------------------------------------
// Supabase client ขนาดเล็กที่สุดที่โค้ดหน้าเว็บเรียกได้
// รองรับเท่าที่ app.js ใช้จริง: auth 3 ตัว, from().select().eq().order().limit(),
// rpc(name, params).range(from, to) — รูปแบบเดียวกับ mockRpc ใน tests/test_app.js
// ต่างกันแค่ปลายทางเป็น REST จริงไม่ใช่ข้อมูลปลอม
// ---------------------------------------------------------------------------
function makeRestClient(accessToken, session) {
  const headers = (extra) => Object.assign({
    apikey: KEY,
    Authorization: "Bearer " + (accessToken || KEY),
    "Content-Type": "application/json"
  }, extra || {});

  async function call(url, opts) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      return { data: null, error: { message: "ต่อ " + url + " ไม่ได้: " + (e.message || e) } };
    }
    const text = await res.text();
    if (!res.ok) return { data: null, error: { message: "HTTP " + res.status + " " + url + " — " + text.slice(0, 300) } };
    if (!text) return { data: [], error: null };
    try {
      return { data: JSON.parse(text), error: null };
    } catch (e) {
      return { data: null, error: { message: "ตอบกลับไม่ใช่ JSON จาก " + url } };
    }
  }

  function rpc(name, params) {
    let range = null;
    const builder = {
      range(from, to) { range = { from, to }; return builder; },
      then(ok, bad) {
        const h = range ? headers({ Range: range.from + "-" + range.to }) : headers();
        return call(BASE + "/rest/v1/rpc/" + name, {
          method: "POST", headers: h, body: JSON.stringify(params || {})
        }).then(ok, bad);
      }
    };
    return builder;
  }

  function from(table) {
    const q = { select: "*", eq: [], order: [], limit: null };
    const builder = {
      select(cols) { if (cols) q.select = cols; return builder; },
      eq(col, val) { q.eq.push([col, val]); return builder; },
      order(col, opts) { q.order.push(col + "." + (!opts || opts.ascending !== false ? "asc" : "desc")); return builder; },
      limit(n) { q.limit = n; return builder; },
      then(ok, bad) {
        const p = new URLSearchParams();
        p.set("select", q.select);
        q.eq.forEach(([c, v]) => p.append(c, "eq." + v));
        if (q.order.length) p.set("order", q.order.join(","));
        if (q.limit != null) p.set("limit", String(q.limit));
        return call(BASE + "/rest/v1/" + table + "?" + p.toString(), {
          method: "GET", headers: headers()
        }).then(ok, bad);
      }
    };
    return builder;
  }

  return {
    auth: {
      async getSession() { return { data: { session } }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { return { error: null }; }
    },
    from,
    rpc
  };
}

async function signIn(email, password) {
  const res = await fetch(BASE + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const text = await res.text();
  if (!res.ok) throw new Error("ล็อกอินไม่ผ่าน: HTTP " + res.status + " — " + text.slice(0, 200));
  const body = JSON.parse(text);
  if (!body.access_token) throw new Error("ล็อกอินผ่านแต่ไม่ได้ access_token กลับมา");
  return { token: body.access_token, session: { user: body.user || { email }, access_token: body.access_token } };
}

// ---------------------------------------------------------------------------
// การนับ — ส่วนเดียวในไฟล์นี้ที่เป็นตรรกะของตัวเอง
// นับจาก rotationData ที่หน้าเว็บคำนวณไว้แล้ว ไม่คำนวณ x/y/zone/edge ซ้ำ
// ---------------------------------------------------------------------------
function countEdge(rotationData) {
  const results = (rotationData && rotationData.results) || [];
  const out = {
    instruments: results.length,
    withPoint: 0, currentEdge: 0, currentCore: 0, currentUnlabelled: 0,
    historyPoints: 0, historyEdge: 0,
    edgeTickers: []
  };
  results.forEach((r) => {
    const pts = r.points || [];
    const last = pts.length ? pts[pts.length - 1] : null;
    if (last) {
      out.withPoint++;
      if (last.edge === "Edge") { out.currentEdge++; out.edgeTickers.push(r.ticker); }
      else if (last.edge === "Core") out.currentCore++;
      else out.currentUnlabelled++;
    }
    (r.history || []).forEach((p) => {
      if (p.edge == null) return;
      out.historyPoints++;
      if (p.edge === "Edge") out.historyEdge++;
    });
  });
  return out;
}

const pct = (a, b) => (b ? (100 * a / b) : null);
const fmtPct = (v) => (v == null ? "—" : v.toFixed(1) + "%");
const fmtNum = (v, d) => (v == null ? "—" : Number(v).toFixed(d == null ? 2 : d));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const hit = argv.find((a) => a.startsWith("--" + name + "="));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const wantJson = argv.includes("--json");

  const email = process.env.QD_EMAIL;
  const password = process.env.QD_PASSWORD;
  if (!email || !password) {
    console.error("ต้องมี QD_EMAIL และ QD_PASSWORD ใน environment");
    console.error("ตาราง instruments เปิดให้อ่านเฉพาะ role authenticated จึงต้องล็อกอินก่อน");
    console.error("ตัวอย่าง:  QD_EMAIL=you@example.com QD_PASSWORD='...' node tools/edge-share.js");
    process.exit(2);
  }

  console.log("ปลายทาง : " + BASE);
  const { token, session } = await signIn(email, password);
  console.log("ล็อกอิน  : ผ่าน\n");

  const dom = loadPage();
  const { window } = dom;
  const QD = window.QD;
  if (!QD) throw new Error("หน้าเว็บไม่ได้ export window.QD");

  // โค้ดจริงของหน้าเว็บทั้งเส้น: init -> bootDashboard -> loadInstruments,
  // loadUniverses, ตั้ง benchmark = SPY, ผูก handler ของ <select> ทุกตัว
  await QD.init(makeRestClient(token, session));
  if (!QD.state.session) throw new Error("init() ไม่เห็น session — client shim ตอบ getSession ผิดรูป");
  if (!QD.state.instruments.length) throw new Error("โหลด instruments ไม่ได้ (RLS หรือสิทธิ์)");

  const bench = QD.state.instruments.find((i) => i.id === QD.state.momentum.benchmarkAssetId);
  console.log("instruments ที่โหลดได้ : " + QD.state.instruments.length);
  console.log("benchmark ที่หน้าเว็บเลือกเอง : " + (bench ? bench.ticker : "(ไม่มี)"));

  const universeEl = window.document.getElementById("momUniversePicker");
  const tfEl = window.document.getElementById("momTimeframePicker");
  if (!universeEl || !tfEl) throw new Error("หาตัวเลือก Universe/Timeframe ในหน้าเว็บไม่เจอ");

  const allUniverses = Array.from(universeEl.options).map((o) => o.value);
  const allTimeframes = Array.from(tfEl.options).map((o) => o.value);
  const universes = flag("universe") ? flag("universe").split(",") : allUniverses;
  const timeframes = flag("timeframe") ? flag("timeframe").split(",") : allTimeframes;
  universes.forEach((u) => { if (!allUniverses.includes(u)) throw new Error("ไม่มี universe ชื่อ " + u); });
  timeframes.forEach((t) => { if (!allTimeframes.includes(t)) throw new Error("ไม่มีกรอบเวลาชื่อ " + t); });

  console.log("universe ที่จะวัด : " + universes.join(", "));
  console.log("กรอบเวลาที่จะวัด : " + timeframes.join(", ") + "\n");

  const setPicker = (el, value) => {
    el.value = value;
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  };

  const rows = [];
  for (const tf of timeframes) {
    for (const uni of universes) {
      setPicker(universeEl, uni);
      setPicker(tfEl, tf);
      const started = Date.now();
      await QD.runMomentumCalculate();
      const errText = (window.document.getElementById("momCalculateError") || {}).textContent || "";
      const rd = QD.state.momentum.rotationData;
      const c = countEdge(rd);
      const scale = (rd && rd.scale) || {};
      rows.push({
        timeframe: tf,
        universe: uni,
        members: QD.state.momentum.universeInstruments.length,
        pricePeriodsFetched: QD.state.momentum.loadedPricePeriods,
        needsRefetch: QD.momentumNeedsFetch(),
        months: (rd && rd.months && rd.months.length) || 0,
        m: rd ? rd.m : null,
        k: rd ? rd.k : null,
        rsStep: scale.rsStep == null ? null : scale.rsStep,
        momStep: scale.momStep == null ? null : scale.momStep,
        rsEdge: scale.rsEdge == null ? null : scale.rsEdge,
        momEdge: scale.momEdge == null ? null : scale.momEdge,
        nSteps: scale.nSteps || 0,
        plotted: c.withPoint,
        currentEdge: c.currentEdge,
        currentCore: c.currentCore,
        currentUnlabelled: c.currentUnlabelled,
        currentEdgePct: pct(c.currentEdge, c.withPoint),
        historyPoints: c.historyPoints,
        historyEdge: c.historyEdge,
        historyEdgePct: pct(c.historyEdge, c.historyPoints),
        edgeTickers: c.edgeTickers,
        seconds: (Date.now() - started) / 1000,
        error: errText.trim()
      });
      const r = rows[rows.length - 1];
      console.log(
        "[" + tf + " / " + uni + "] " +
        "สมาชิก " + r.members + " · วาดได้ " + r.plotted +
        " · Edge " + r.currentEdge + " (" + fmtPct(r.currentEdgePct) + ")" +
        " · ทั้งหน้าต่าง " + fmtPct(r.historyEdgePct) +
        " · " + r.seconds.toFixed(1) + "s" +
        (r.error ? " · ERROR: " + r.error : "")
      );
    }
  }

  // ----- ตาราง -----
  const pad = (s, n, right) => {
    s = String(s);
    return right ? s.padStart(n) : s.padEnd(n);
  };
  console.log("\n" + "=".repeat(118));
  console.log("สัดส่วน Edge แยก Universe × Timeframe — เกณฑ์ Edge = 2 x ค่ากลางการขยับต่องวด (ต่อแกน) ในหน้าต่าง " + QD.ZONE_STRIP_MONTHS + " เดือน");
  console.log("=".repeat(118));
  console.log([
    pad("กรอบเวลา", 10), pad("universe", 14), pad("สมาชิก", 7, true), pad("วาดได้", 7, true),
    pad("Edge", 6, true), pad("Core", 6, true), pad("%Edge", 8, true),
    pad("%Edge(หน้าต่าง)", 16, true), pad("rsEdge", 9, true), pad("momEdge", 9, true), pad("nSteps", 8, true)
  ].join(" "));
  console.log("-".repeat(118));
  rows.forEach((r) => {
    console.log([
      pad(r.timeframe, 10), pad(r.universe, 14), pad(r.members, 7, true), pad(r.plotted, 7, true),
      pad(r.currentEdge, 6, true), pad(r.currentCore, 6, true), pad(fmtPct(r.currentEdgePct), 8, true),
      pad(fmtPct(r.historyEdgePct), 16, true), pad(fmtNum(r.rsEdge), 9, true), pad(fmtNum(r.momEdge), 9, true),
      pad(r.nSteps, 8, true)
    ].join(" "));
  });
  console.log("-".repeat(118));

  // ----- เทียบเกณฑ์ยอมรับของมติ 40 -----
  // เกณฑ์ที่เคาะไว้วัดจาก us_sector (11 กอง) ได้ Edge 1-2 กอง = 9.1% - 18.2%
  // Universe อื่นมีสมาชิกไม่เท่ากัน สิ่งที่เทียบกันได้จึงเป็นสัดส่วน ไม่ใช่จำนวนกอง
  // ขอบ 40% เป็นตัวเลขที่มติ 40 เขียนไว้เองเป็นตัวอย่างของ "สัญญาณให้กลับมาคิด"
  // (Thematic ได้ 40 จาก 54) — ไม่ใช่ค่าที่คำนวณมาจากอะไร
  const BAND_LOW = 100 / 11, BAND_HIGH = 200 / 11, RETHINK_HIGH = 40, RETHINK_LOW = 2;
  console.log("\nเกณฑ์ยอมรับของมติ 40: us_sector ได้ Edge 1-2 จาก 11 = " + fmtPct(BAND_LOW) + " - " + fmtPct(BAND_HIGH));
  console.log("ธงเตือน: สัดส่วนปัจจุบันเกิน " + RETHINK_HIGH + "% หรือต่ำกว่า " + RETHINK_LOW + "% = สัญญาณให้กลับมาคิดเรื่องเกณฑ์\n");
  let flags = 0;
  rows.forEach((r) => {
    const v = r.currentEdgePct;
    let verdict;
    if (r.error) { verdict = "คำนวณไม่ผ่าน"; flags++; }
    else if (v == null) { verdict = "ไม่มีจุดให้นับ"; flags++; }
    else if (v > RETHINK_HIGH || v < RETHINK_LOW) { verdict = "⚠ นอกช่วง — ให้กลับมาคิด"; flags++; }
    else if (v >= BAND_LOW && v <= BAND_HIGH) verdict = "ตรงช่วงที่เคาะไว้";
    else verdict = "ต่างจากช่วงที่เคาะไว้แต่ยังไม่ถึงธงเตือน";
    console.log("  " + pad(r.timeframe + " / " + r.universe, 26) + " " + pad(fmtPct(v), 8, true) + "  " + verdict +
      (r.edgeTickers.length ? "   [" + r.edgeTickers.join(" ") + "]" : ""));
  });
  console.log("\nธงเตือนทั้งหมด: " + flags + " จาก " + rows.length + " ชุด");

  if (wantJson) console.log("\n" + JSON.stringify({ base: BASE, measuredAt: new Date().toISOString(), rows }, null, 2));

  dom.window.close();
  process.exitCode = 0;
}

if (require.main === module) {
  main().catch((e) => {
    console.error("\nล้มเหลว: " + (e && e.stack ? e.stack : e));
    process.exit(1);
  });
}

module.exports = { countEdge, makeRestClient };
