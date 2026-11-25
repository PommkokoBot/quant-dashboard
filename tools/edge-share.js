#!/usr/bin/env node
/**
 * วัดสัดส่วน Core/Edge แยก Universe × Timeframe จากข้อมูลจริง — คำสั่งตรวจของมติ 40
 * เกณฑ์ธงเตือนเป็นของมติ 46 อยู่ในฟังก์ชันล้วน judgeRow() ซึ่งเทสต์ยิงตรงได้
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
 *   · ธงเตือนของมติ 46 ไม่ได้บอกว่าสัดส่วนดีหรือไม่ดี มันถามคำถามเดียวคือ
 *     "ป้าย Core/Edge ยังแยกแยะอะไรได้อยู่ไหม" — ดังเมื่อแปะเกือบทุกกอง
 *     หรือไม่เคยแปะเลย ซึ่งทั้งสองทางคือป้ายที่เลิกมีประโยชน์
 *   · ไม่ใช่ชุดเทสต์ ไม่เข้า `npm test` และ CI รันไม่ได้ (ต้องมีเน็ตและต้อง
 *     ล็อกอิน) — ชุดเทสต์ของ engine คือ tests/test_rotation.js
 *
 * วิธีรัน
 * ------
 *   bash/zsh    QD_EMAIL=... QD_PASSWORD=... node tools/edge-share.js
 *   PowerShell  $env:QD_EMAIL='...'; $env:QD_PASSWORD='...'; npm run edge:share
 *
 * ⚠️ `npm run edge:share --json` ส่งธงไม่ถึงสคริปต์ (npm กินไปเอง) ต้องเขียน
 *    `npm run edge:share -- --json` หรือเรียก node ตรง ๆ
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
 * รหัสออก: 0 = วัดครบทุกชุด · 1 = มีชุดที่คำนวณไม่ผ่าน (ตัวเลขของชุดนั้นใช้ไม่ได้)
 *          2 = ไม่ได้ตั้ง QD_EMAIL/QD_PASSWORD
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

// คำขอเดียวไม่ควรใช้เกินนี้ · ชุดที่หนักที่สุด (day × thematic) แบ่งเป็น 10 หน้า
// หน้าละไม่กี่วินาที ถ้าหน้าไหนเกิน 60 วินาทีแปลว่ามีอะไรผิด ไม่ใช่แค่ช้า
const REQUEST_TIMEOUT_MS = Number(process.env.QD_TIMEOUT_MS || 60000);

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
      // timeout เพื่อให้คำขอที่ค้างกลายเป็น error ที่อ่านได้ ไม่ใช่เครื่องเงียบไปเฉย ๆ
      res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, opts));
    } catch (e) {
      const why = (e && e.name === "TimeoutError")
        ? "ไม่ตอบใน " + (REQUEST_TIMEOUT_MS / 1000) + " วินาที"
        : (e.message || e);
      return { data: null, error: { message: "ต่อ " + url + " ไม่ได้: " + why } };
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

  // 🔴 `.range()` ต้องเป็น "พารามิเตอร์ใน URL" ไม่ใช่ HTTP header `Range`
  //
  // ฉบับแรกของไฟล์นี้ส่ง header `Range: 0-3999` ตามที่ผมเข้าใจว่า PostgREST ใช้ ·
  // ของจริงในไลบรารีที่หน้าเว็บโหลด (`vendor/supabase.js`) เขียนไว้ว่า
  //     range(from, to) → searchParams.set("offset", from)
  //                       searchParams.set("limit",  to - from + 1)
  // **ไม่มีคำว่า Range-Unit หรือ header Range อยู่ในไลบรารีเลย**
  //
  // ผลของการส่งผิด: เซิร์ฟเวอร์ไม่สนใจ header นั้นแล้วคืนแถวมาทั้งหมดทุกครั้ง ·
  // ลูปแบ่งหน้าใน `app.js` หยุดก็ต่อเมื่อได้แถวน้อยกว่า 4,000 จึง **วนไม่รู้จบ**
  // ทันทีที่ชุดข้อมูลเกิน 4,000 แถว (เจอจริง 24 พ.ย. ที่ month/thematic = 7,614 แถว)
  //
  // นี่เป็นบทเรียนของการ "เขียนตามที่เข้าใจ" แทนการ "อ่านของจริงก่อน" — ไลบรารีอยู่ในrepo
  // ให้เปิดดูได้ตลอดเวลา และใช้เวลาอ่านน้อยกว่าเวลาที่เสียไปกับการค้าง
  function rpc(name, params) {
    let range = null;
    const builder = {
      range(from, to) { range = { from, to }; return builder; },
      then(ok, bad) {
        const qs = new URLSearchParams();
        if (range) {
          qs.set("offset", String(range.from));
          qs.set("limit", String(range.to - range.from + 1));
        }
        const url = BASE + "/rest/v1/rpc/" + name + (range ? "?" + qs.toString() : "");
        return call(url, {
          method: "POST", headers: headers(), body: JSON.stringify(params || {})
        }).then((res) => guardPaging(res, name, range)).then(ok, bad);
      }
    };
    return builder;
  }

  // ด่านกันวนไม่รู้จบ: ถ้าขอมา N แถวแล้วได้กลับมามากกว่า N แปลว่าการแบ่งหน้า
  // "ไม่ถูกนำไปใช้" ซึ่งเป็นสภาพเดียวกับที่ทำให้ลูปใน app.js วนตลอดกาล ·
  // ดังขึ้นมาทันทีดีกว่าปล่อยให้เครื่องเงียบไปสิบนาทีแล้วไม่มีใครรู้ว่าเกิดอะไร
  function guardPaging(res, name, range) {
    if (!range || res.error || !Array.isArray(res.data)) return res;
    const asked = range.to - range.from + 1;
    if (res.data.length > asked) {
      return { data: null, error: { message:
        "การแบ่งหน้าไม่ถูกนำไปใช้ที่ " + name + ": ขอ " + asked +
        " แถว ได้กลับมา " + res.data.length + " แถว — ถ้าปล่อยไว้ลูปใน app.js จะวนไม่รู้จบ" } };
    }
    return res;
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
    // ไลบรารีจริงตั้งทั้งสอง header ตอนสร้าง auth client — ส่งให้ตรงกัน
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
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

// ===== เกณฑ์ธงเตือนของมติ 46 =====
//
// 🔴 ธงนี้ตอบคำถามเดียว: **ป้าย Core/Edge ยังแยกแยะอะไรได้อยู่ไหม**
// ไม่ได้ตอบว่า "สัดส่วนวันนี้สวยไหม" ซึ่งเป็นคนละคำถามและไม่มีใครต้องการคำตอบ
//
// ป้ายเลิกมีความหมายได้สองทาง และมีแค่สองทางนี้:
//   · แปะเกือบทุกกอง  → เปิดหน้าเว็บมาเห็น Edge เต็มไปหมด แยกไม่ออกว่าตัวไหนน่าจับตา
//   · ไม่เคยแปะเลย    → คอลัมน์ว่างถาวร เป็นฟีเจอร์ตายที่กินที่บนจอ
//
// ⚠️ ฉบับแรก (23 พ.ย.) ตั้งขอบบนไว้ที่ 40% โดยอ้างว่ามาจากตัวอย่างในมติ 40 ที่เขียนว่า
// "Thematic ได้ 40 จาก 54" — **แต่ 40 จาก 54 คือ 74% ไม่ใช่ 40%** คือหยิบจำนวนกอง
// มาใส่เป็นเปอร์เซ็นต์ · ขอบจึงไปตกกลางฐานปกติของรายเดือน (วัด 24 พ.ย. 2026: 32.5-37.7%
// ทุก universe) แล้วดังใส่พฤติกรรมปกติ ซึ่งชนกติกา §7.5 "ด่านที่ดังทุกวันคือด่านที่เลิกถูกอ่าน"
//
// และตัดสินจาก **ค่าตลอดหน้าต่าง ZONE_STRIP_MONTHS เดือน ไม่ใช่ค่าวันเดียว** —
// ค่าวันเดียวแกว่งแรงเกินจะเป็นสัญญาณ (asset_class วัดวันนั้นได้ 0% ขณะที่ค่าตลอด
// หน้าต่างของมันคือ 5.1%)
const LABEL_USELESS_HIGH = 70;   // ≥ นี้ = แปะเกือบทุกกอง
// กลุ่มที่วาดได้น้อยกว่านี้ ห้ามตีเป็นเปอร์เซ็นต์และไม่ขึ้นธง (มติ 46): 5 กองมีค่าได้แค่
// 0/20/40/60/80/100% ซึ่งไม่มีค่าไหนตกในช่วงที่เคย calibrate ไว้เลย (9.1-18.2%)
// การพิมพ์ % ของกลุ่มขนาดนี้จึงหลอกตาคนอ่านว่าตัวเลขละเอียดกว่าที่เป็น
const SMALL_UNIVERSE_N = 10;

// ฟังก์ชันล้วน — รับแถวผล คืนคำตัดสิน ไม่แตะ I/O ไม่แตะเวลา
// (มติ 44: ด่านตรวจต้องเป็นฟังก์ชันล้วนที่เทสต์ยิงตรงได้ ไม่ใช่ตรรกะฝังในลูปพิมพ์)
function judgeRow(r) {
  const small = r.plotted > 0 && r.plotted < SMALL_UNIVERSE_N;
  if (r.error) return { small, flagged: true, reason: "error", text: "คำนวณไม่ผ่าน" };
  if (r.plotted === 0) return { small, flagged: true, reason: "no_points", text: "ไม่มีจุดให้นับ" };
  if (small) return { small, flagged: false, reason: "small_universe", text: "กลุ่มเล็ก — รายงานเป็นจำนวน ไม่ตัดสินด้วยสัดส่วน" };
  const w = r.historyEdgePct;
  if (w == null) return { small, flagged: false, reason: "no_history", text: "ยังไม่มีประวัติพอจะตัดสิน" };
  if (w >= LABEL_USELESS_HIGH) return { small, flagged: true, reason: "label_everywhere", text: "⚠ ป้ายแปะเกือบทุกกอง — ให้กลับมาคิดเรื่องเกณฑ์" };
  if (w === 0) return { small, flagged: true, reason: "label_never", text: "⚠ ป้ายไม่เคยขึ้นเลยในหน้าต่างนี้ — ให้กลับมาคิดเรื่องเกณฑ์" };
  return { small, flagged: false, reason: "ok", text: "ป้ายยังแยกแยะได้" };
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
    console.error("PowerShell:  $env:QD_EMAIL='you@example.com'; $env:QD_PASSWORD='...'; npm run edge:share");
    console.error("bash/zsh  :  QD_EMAIL=you@example.com QD_PASSWORD='...' node tools/edge-share.js");
    process.exitCode = 2;
    return;
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
      // หน้าเว็บมีช่อง error สามช่อง และแต่ละชั้นเขียนคนละช่อง —
      // `loadMomentumUniverseData` (ชั้นดึงข้อมูล) เขียนที่ `momLeaderboardError`
      // ส่วน `runMomentumCalculate` เขียนที่ `momCalculateError` ·
      // ฉบับแรกอ่านแค่ช่องเดียว ทำให้ "ดึงข้อมูลไม่สำเร็จ" ผ่านไปเป็นผลสำเร็จ
      // ที่วาดได้ 0 กอง โดยไม่มีอะไรบอก (เจอ 24 พ.ย. ตอนทดสอบด่านกันวนไม่รู้จบ)
      const errText = ["momCalculateError", "momLeaderboardError", "momParamError"]
        .map((id) => ((window.document.getElementById(id) || {}).textContent || "").trim())
        .filter(Boolean)
        .join(" · ");
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
  const isSmall = (r) => judgeRow(r).small;
  // ช่องสัดส่วน: กลุ่มเล็กแสดงเป็นจำนวน n/N ไม่ใช่ %
  const cellCurrent = (r) => (isSmall(r) ? r.currentEdge + "/" + r.plotted : fmtPct(r.currentEdgePct));
  const cellWindow = (r) => (isSmall(r)
    ? (r.historyPoints ? r.historyEdge + "/" + r.historyPoints : "-")
    : fmtPct(r.historyEdgePct));

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
      pad(r.currentEdge, 6, true), pad(r.currentCore, 6, true), pad(cellCurrent(r), 8, true),
      pad(cellWindow(r), 16, true), pad(fmtNum(r.rsEdge), 9, true), pad(fmtNum(r.momEdge), 9, true),
      pad(r.nSteps, 8, true)
    ].join(" "));
  });
  console.log("-".repeat(118));

  // ----- เทียบเกณฑ์ของมติ 46 (ตรรกะอยู่ใน judgeRow ด้านบน) -----
  console.log("\nเกณฑ์มติ 46 — ธงดังเมื่อป้าย Core/Edge เลิกแยกแยะ:");
  console.log("  · สัดส่วนตลอด " + QD.ZONE_STRIP_MONTHS + " เดือน ≥ " + LABEL_USELESS_HIGH + "%  (แปะเกือบทุกกอง)");
  console.log("  · สัดส่วนตลอด " + QD.ZONE_STRIP_MONTHS + " เดือน = 0   (ไม่เคยแปะเลย)");
  console.log("  · กลุ่มที่วาดได้ < " + SMALL_UNIVERSE_N + " กอง รายงานเป็นจำนวน ไม่ตีเป็นเปอร์เซ็นต์และไม่ขึ้นธง");
  console.log("  (อ้างอิง: us_sector ที่ใช้ calibrate ได้ Edge 1-2 จาก 11 ณ วันที่เคาะ)\n");

  let flags = 0;
  rows.forEach((r) => {
    const j = judgeRow(r);
    r.verdict = j.reason;          // ลง JSON ด้วย เพื่อให้รอบหน้าเทียบด้วยเครื่องได้
    r.flagged = j.flagged;
    if (j.flagged) flags++;
    console.log("  " + pad(r.timeframe + " / " + r.universe, 26) + " " + pad(cellWindow(r), 12, true) +
      "  " + j.text + (r.edgeTickers.length ? "   [" + r.edgeTickers.join(" ") + "]" : ""));
  });
  console.log("\nธงเตือนทั้งหมด: " + flags + " จาก " + rows.length + " ชุด");

  // ชุดไหนคำนวณไม่ผ่าน = ตัวเลขของชุดนั้นเชื่อไม่ได้ · ต้องออกด้วยรหัสไม่เป็นศูนย์
  // ไม่ใช่พิมพ์ตารางสวย ๆ แล้วจบแบบสำเร็จ ซึ่งคนอ่านจะไม่ทันสังเกต
  const broken = rows.filter((r) => r.error);
  if (broken.length) {
    console.error("\n" + broken.length + " ชุดคำนวณไม่ผ่าน — ตัวเลขของชุดนั้นใช้ไม่ได้:");
    broken.forEach((r) => console.error("  " + r.timeframe + " / " + r.universe + ": " + r.error));
    process.exitCode = 1;
  }

  if (wantJson) console.log("\n" + JSON.stringify({ base: BASE, measuredAt: new Date().toISOString(), rows }, null, 2));

  dom.window.close();
  // ⛔ ห้ามตั้ง process.exitCode = 0 ตรงนี้ — มันจะลบรหัส 1 ที่ตั้งไว้ตอนเจอชุดที่
  // คำนวณไม่ผ่านด้านบน แล้วรอบที่พังจะจบแบบ "สำเร็จ" (เจอจริงตอนเขียนด่าน 24 พ.ย.)
  // ค่าเริ่มต้นของ Node เป็น 0 อยู่แล้ว จึงไม่ต้องตั้งเอง
}

if (require.main === module) {
  main().catch((e) => {
    console.error("\nล้มเหลว: " + (e && e.stack ? e.stack : e));
    // ห้าม process.exit() ตรงนี้ — บน Windows การตัดจบขณะที่ handle ของ fetch
    // ยังไม่ปิด ทำให้ libuv ขึ้น `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
    // ต่อท้ายข้อความ error (เจอจริง 23 พ.ย.) · ตั้ง exitCode แล้วปล่อยให้ Node เก็บของเอง
    process.exitCode = 1;
  });
}

module.exports = { countEdge, makeRestClient, judgeRow, LABEL_USELESS_HIGH, SMALL_UNIVERSE_N };
