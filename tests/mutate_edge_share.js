#!/usr/bin/env node
/**
 * พิสูจน์ว่า tests/harness_edge_share.js แดงได้
 *
 * harness_edge_share.js เป็นด่านเดียวที่เฝ้า tools/edge-share.js ซึ่งเป็น
 * คำสั่งตรวจของมติ 40 ถ้าด่านนั้นเคยเห็นแต่สีเขียว มันก็เป็นคอมเมนต์ที่มี
 * เครื่องหมายถูก ไม่ใช่ด่าน ไฟล์นี้จึงทำลายเครื่องมือทีละจุด แล้วล้มเหลวถ้า
 * จุดไหนทำลายแล้วด่านไม่ดัง
 *
 * ทุกตัวในนี้เป็นความผิดพลาดที่คนเขียนเครื่องมือแบบนี้พลาดได้จริง:
 * อ่านจุดแรกแทนจุดล่าสุด · ลืม dispatch event จึงวัด universe เดิมซ้ำสี่รอบ
 * โดยไม่มีอะไรบอก · หารด้วยตัวหารผิด · ปล่อยให้ "ไม่มีจุดให้นับ" ผ่านเป็น 0%
 *
 * กลไกต่างจาก mutate_rotation.js หนึ่งอย่าง: ที่นั่นคัดลอกหน้าเว็บไปโฟลเดอร์
 * ชั่วคราวแล้วชี้ด้วย QD_HTML ที่นี่ทำไม่ได้ เพราะ tools/edge-share.js
 * require ../tests/_page.js แบบ relative สำเนาจึงต้องอยู่ใน tools/ เหมือนเดิม
 * และถูกลบทิ้งทุกทางออก (ปกติ, error, Ctrl-C)
 *
 *   node tests/mutate_edge_share.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "tools", "edge-share.js");
const MUTANT_REL = path.join("tools", "__mutant_edge_share.js");
const MUTANT = path.join(ROOT, MUTANT_REL);
const SUITE = "tests/harness_edge_share.js";

const ORIGINAL = fs.readFileSync(SRC, "utf8");

function cleanup() {
  try { fs.rmSync(MUTANT, { force: true }); } catch (e) { /* ไม่มีอะไรให้ลบ */ }
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// เขียนสำเนาที่ดัดแปลง และดังถ้า anchor ไม่ unique — mutation ที่ anchor
// เคลื่อนจะรายงานว่า "จับได้" ด้วยเหตุผลผิด ซึ่งเป็นความพังที่ไฟล์นี้มีไว้กัน
function swap(from, to) {
  const n = ORIGINAL.split(from).length - 1;
  if (n !== 1) throw new Error("anchor เจอ " + n + " ครั้ง ควรเป็น 1: " + from.slice(0, 70));
  fs.writeFileSync(MUTANT, ORIGINAL.replace(from, to));
}

function runSuite() {
  try {
    execFileSync(process.execPath, [SUITE], {
      cwd: ROOT, stdio: "pipe",
      env: Object.assign({}, process.env, { QD_EDGE_TOOL: MUTANT_REL })
    });
    return 0;
  } catch (e) {
    return e.status == null ? 1 : e.status;
  }
}

const MUTATIONS = [
  { id: "E1", name: "อ่านจุดแรกของ tail แทนจุดล่าสุด",
    why: "สถานะปัจจุบันคือจุดล่าสุด การสลับนี้ให้สถานะของ 12-30 งวดก่อน",
    apply: () => swap("const last = pts.length ? pts[pts.length - 1] : null;",
                      "const last = pts.length ? pts[0] : null;") },

  { id: "E2", name: "นับจุดที่ยังไม่มีป้าย Core/Edge เข้าตัวหารของทั้งหน้าต่าง",
    why: "จุดที่ scale ยังคำนวณไม่ได้จะถ่วงสัดส่วนให้ต่ำกว่าจริง",
    apply: () => swap("      if (p.edge == null) return;\n", "") },

  { id: "E3", name: "หารสัดส่วนด้วยจำนวนกองทั้งหมด ไม่ใช่กองที่วาดได้",
    why: "กองที่ประวัติสั้นเกินจะไม่มีจุด แต่ยังอยู่ในรายชื่อ ตัวหารจึงใหญ่เกิน",
    apply: () => swap("currentEdgePct: pct(c.currentEdge, c.withPoint),",
                      "currentEdgePct: pct(c.currentEdge, c.instruments),") },

  { id: "E4", name: "เก็บชื่อกองที่เป็น Core ลงรายชื่อ Edge",
    why: "รายชื่อท้ายบรรทัดคือสิ่งเดียวที่ให้ไปเปิดดูบนหน้าเว็บได้ สลับแล้วหลงทาง",
    apply: () => swap('if (last.edge === "Edge") { out.currentEdge++; out.edgeTickers.push(r.ticker); }\n      else if (last.edge === "Core") out.currentCore++;',
                      'if (last.edge === "Edge") { out.currentEdge++; }\n      else if (last.edge === "Core") { out.currentCore++; out.edgeTickers.push(r.ticker); }') },

  { id: "E5", name: "ตั้งค่า <select> แต่ไม่ dispatch change",
    why: "handler ของหน้าเว็บไม่ทำงาน state ไม่เปลี่ยน จึงวัด universe/กรอบเวลาเดิมซ้ำทุกรอบ โดยตารางยังขึ้นสวยงาม",
    apply: () => swap("    el.dispatchEvent(new window.Event(\"change\", { bubbles: true }));\n", "") },

  { id: "E6", name: "เปลี่ยน universe แต่ไม่เปลี่ยนกรอบเวลา",
    why: "คัดลอกบรรทัดแล้วลืมแก้ตัวแปร — ผลคือทุกแถวเป็นกรอบเวลาเดียว",
    apply: () => swap("      setPicker(tfEl, tf);\n", "") },

  { id: "E7", name: "ส่ง anon key แทน token ของ session",
    why: "instruments เปิดให้ authenticated เท่านั้น ลืมแล้วจะได้ลิสต์ว่างหรือ 401",
    apply: () => swap('Authorization: "Bearer " + (accessToken || KEY),',
                      'Authorization: "Bearer " + KEY,') },

  { id: "E8", name: "ไม่ส่ง Range header ตอนเรียก period_end_closes",
    why: "PostgREST ตัดที่ 1,000 แถวเงียบ ๆ และตัดกองทิ้งทั้งกอง — บั๊กเดิมของโปรเจกต์นี้",
    apply: () => swap("const h = range ? headers({ Range: range.from + \"-\" + range.to }) : headers();",
                      "const h = headers();") },

  { id: "E9", name: "ไม่มีจุดให้นับ ถือว่าผ่าน",
    why: "universe ที่โหลดไม่สำเร็จจะรายงาน 0% เหมือนกับ universe ที่ Edge จริง 0 กอง",
    apply: () => swap('else if (v == null) { verdict = "ไม่มีจุดให้นับ"; flags++; }',
                      'else if (v == null) { verdict = "ไม่มีจุดให้นับ"; }') },

  { id: "E10", name: "ไม่มี credential ก็เดินต่อ",
    why: "จะไปล้มที่ชั้นล็อกอินด้วยข้อความที่อ่านไม่รู้เรื่อง แทนที่จะบอกว่าต้องตั้งตัวแปรอะไร",
    apply: () => swap("  if (!email || !password) {", "  if (false) {") },

  { id: "E11", name: "รับ session ที่ init() มองไม่เห็นว่าล็อกอินแล้ว",
    why: "shim ตอบ getSession ผิดรูปแล้ว bootDashboard จะไม่ถูกเรียก แต่หน้าเว็บไม่ error",
    apply: () => swap("      async getSession() { return { data: { session } }; },",
                      "      async getSession() { return { data: { session: null } }; },") },

  { id: "E12", name: "นับ Core เป็น Edge ในสถิติทั้งหน้าต่าง",
    why: "สองสัดส่วนในตารางจะขัดกันเอง และคนอ่านจะเชื่อตัวที่ผิด",
    apply: () => swap('      if (p.edge === "Edge") out.historyEdge++;',
                      '      if (p.edge === "Core") out.historyEdge++;') }
];

console.log("ตรวจว่า " + SUITE + " แดงได้ — ดัดแปลง tools/edge-share.js " + MUTATIONS.length + " แบบ\n");

// ก่อนอื่น: สำเนาที่ไม่ได้ดัดแปลงต้องเขียว ไม่งั้นที่เหลือตีความไม่ได้
fs.writeFileSync(MUTANT, ORIGINAL);
const baseline = runSuite();
if (baseline !== 0) {
  console.error("สำเนาที่ยังไม่ดัดแปลงก็แดงแล้ว (exit " + baseline + ") — แก้ให้เขียวก่อน");
  process.exit(1);
}
console.log("baseline: สำเนาที่ยังไม่ดัดแปลง -> เขียว\n");

let missed = 0;
for (const m of MUTATIONS) {
  let status;
  try {
    m.apply();
    status = runSuite();
  } catch (e) {
    console.log("  " + m.id + "  BROKEN  " + m.name + "  (" + e.message + ")");
    missed++;
    continue;
  }
  const caught = status !== 0;
  if (!caught) missed++;
  console.log("  " + m.id + "  " + (caught ? "จับได้ " : "หลุด  ") + " " + m.name);
  if (!caught) console.log("        เหตุผลที่ควรจับได้: " + m.why);
}

cleanup();
console.log("\nจับได้ " + (MUTATIONS.length - missed) + " จาก " + MUTATIONS.length);
if (missed) {
  console.error("มี " + missed + " แบบที่ด่านไม่ดัง — ด่านนี้ยังเฝ้าไม่ครบ");
  process.exit(1);
}
console.log("ด่าน " + SUITE + " แดงได้ทุกแบบที่ลอง");
