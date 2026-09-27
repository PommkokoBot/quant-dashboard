// Round 3A block 1 (2026-09-27): event groups — date generators, the preview
// table, saving a draft through save_event_group, and the admin group review
// (expand, edit a wrong date, save, approve, reject).
// Usage: QD_HTML=<index.html> node tests/test_event_groups.js

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.resolve(__dirname, process.env.QD_HTML || "../index.html"), "utf8")
  .replace(/<script[^>]*src=[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/", beforeParse(w) { w.__QD_TEST__ = true; } });
const w = dom.window, QD = w.QD, doc = w.document;
const flush = (n = 6) => { let p = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r))); return p; };
// jsdom values come from another realm -> compare as plain JSON
const eq = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const $ = (s) => doc.querySelector(s);
const $$ = (s) => Array.from(doc.querySelectorAll(s));
const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

// ---------------- mock Supabase ----------------
const db = { groups: [], seq: 10 };
const calls = [];
function rpc(fn, args) {
  calls.push([fn, args]);
  const r = (data) => Promise.resolve({ data, error: null });
  if (fn === "market_events_between") { const p = r([]); p.range = () => r([]); return p; }
  if (fn === "admin_pending_drafts") return r([]);
  if (fn === "list_event_groups") return r(db.groups.map((g) => ({
    id: g.id, name: g.name, color: g.color, kind: g.kind, status: g.status,
    n_events: g.rows.length, first_date: g.rows[0] && g.rows[0].start,
    last_date: g.rows[g.rows.length - 1] && (g.rows[g.rows.length - 1].end || g.rows[g.rows.length - 1].start),
    creator_email: "meh***@gmail.com" })));
  if (fn === "admin_pending_groups") return r(db.groups.filter((g) => g.status === "draft").map((g) => ({
    id: g.id, name: g.name, color: g.color, kind: g.kind, creator_email: "nop***@hotmail.com",
    created_at: "2026-09-27T00:00:00Z", expires_at: "2026-10-04T00:00:00Z",
    rows: g.rows.map((x, i) => ({ id: 100 + i, start: x.start, end: x.end || null })) })));
  if (fn === "save_event_group") {
    const g = args.p_group_id ? db.groups.find((x) => x.id === args.p_group_id)
                              : (db.groups.push({ id: ++db.seq, status: "draft", rows: [] }), db.groups[db.groups.length - 1]);
    Object.assign(g, { name: args.p_name, color: args.p_color, kind: args.p_kind, rows: args.p_rows });
    return r(g.id);
  }
  if (fn === "approve_event_group") {
    const g = db.groups.find((x) => x.id === args.p_group_id);
    if (g) g.status = "approved";
    return r(g ? g.rows.length : 0);
  }
  if (fn === "delete_event_group") { db.groups = db.groups.filter((x) => x.id !== args.p_group_id); return r(null); }
  return r(null);
}
const sb = {
  rpc, auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} },
  from: () => ({ insert: async () => ({ error: null }) })
};

async function main() {
  // ---------------- pure date generators ----------------
  const jul = QD.generateYearlyDates(4, 7, 2023, 2026);
  eq(jul.map((r) => r.start), ["2023-07-04", "2024-07-04", "2025-07-04", "2026-07-04"]);
  assert.ok(!jul[0].flag && !jul[1].flag && !jul[2].flag, "2023 Tue / 2024 Thu / 2025 Fri are weekdays");
  assert.ok(jul[3].flag.includes("สุดสัปดาห์"), "4 Jul 2026 is a Saturday -> flagged");
  const weekendFlags = QD.generateYearlyDates(4, 7, 1995, 2026).filter((r) => r.flag).length;
  assert.strictEqual(weekendFlags, 9, "9 of the 32 fall on a weekend and are flagged");
  eq(QD.generateYearlyDates(29, 2, 2023, 2026).map((r) => r.start), ["2024-02-29"], "29 Feb only in leap years");
  const nth = QD.generateNthWeekdayDates(3, 5, 1, 2015, 2016); // 3rd Friday of January
  eq(nth.map((r) => r.start), ["2015-01-16", "2016-01-15"]);
  assert.strictEqual(QD.generateNthWeekdayDates(-1, 1, 5, 2026, 2026)[0].start, "2026-05-25", "last Monday of May 2026");
  assert.strictEqual(QD.generateNthWeekdayDates(3, 5, 0, 2026, 2026).length, 12, "every month when month = 0");
  assert.strictEqual(QD.nthWeekdayOfMonth(2026, 2, 0, 5), null, "no 5th Sunday in Feb 2026 -> null");
  console.log("[ok] date generators: fixed yearly (leap-year + weekend flag), nth weekday, last weekday, all months");

  // ---------------- validation ----------------
  assert.strictEqual(QD.validateEventGroupRows([{ start: "2024-01-01" }], "point"), "");
  assert.ok(QD.validateEventGroupRows([], "point").includes("อย่างน้อย 1"));
  assert.ok(QD.validateEventGroupRows(Array.from({ length: QD.EG_MAX_ROWS + 1 }, () => ({ start: "2024-01-01" })), "point").includes("500"));
  assert.ok(QD.validateEventGroupRows([{ start: "" }], "point").includes("วันเริ่ม"));
  assert.ok(QD.validateEventGroupRows([{ start: "2024-05-05", end: "2024-01-01" }], "range").includes("วันจบก่อนวันเริ่ม"));
  eq(QD.sortEventGroupRows([{ start: "2025-01-01" }, { start: "2024-01-01" }]).map((r) => r.start),
    ["2024-01-01", "2025-01-01"], "rows are kept in date order");
  console.log("[ok] validation: empty, over 500, blank date, end before start; rows sorted by date");

  // ---------------- DOM: build a group and save it ----------------
  await QD.init(sb);
  QD.state.session = { user: { email: "mehresix@gmail.com" } };
  await QD.loadEventsTab(); await flush();

  $("#egName").value = "วันชาติสหรัฐฯ";
  $("#egDay").value = "4"; $("#egMonth").value = "7"; $("#egFrom").value = "2023"; $("#egTo").value = "2026";
  $("#egGenBtn").click();
  assert.strictEqual($("#egPreviewBox").classList.contains("hidden"), false, "preview appears");
  assert.strictEqual($("#egCount").textContent, "4");
  assert.strictEqual($$("#egTable tbody tr").length, 4);
  assert.ok($$("#egTable tbody tr")[3].textContent.includes("วันหยุดสุดสัปดาห์"), "weekend note shown in the table");

  // edit one date, delete another
  const firstInput = $('[data-eg-start="0"]');
  firstInput.value = "2023-07-05"; fire(firstInput, "change");
  assert.strictEqual(QD.state.eventsTab.groupDraft[0].start, "2023-07-05");
  $('[data-eg-del="1"]').click();
  assert.strictEqual($("#egCount").textContent, "3", "row removed");

  await QD.saveEventGroup(); await flush();
  const saved = calls.filter((c) => c[0] === "save_event_group").pop();
  assert.ok(saved, "save_event_group called");
  assert.strictEqual(saved[1].p_kind, "point");
  assert.strictEqual(saved[1].p_name, "วันชาติสหรัฐฯ");
  eq(saved[1].p_rows.map((r) => r.start), ["2023-07-05", "2025-07-04", "2026-07-04"]);
  assert.ok(saved[1].p_rows.every((r) => !("end" in r)), "point group sends no end date");
  assert.strictEqual($("#egPreviewBox").classList.contains("hidden"), true, "form cleared after save");
  assert.ok($("#egSuccess").textContent.includes("3 ครั้ง"));
  assert.ok($("#egMyGroups").textContent.includes("วันชาติสหรัฐฯ"), "group listed under 'กลุ่มที่มีอยู่'");
  console.log("[ok] builder: generate → edit a date → delete a row → save draft (RPC payload correct, list refreshed)");

  // ---------------- range group ----------------
  $("#egName").value = "Government shutdown";
  $("#egKind").value = "range"; fire($("#egKind"), "change");
  $("#egMode").value = "manual"; fire($("#egMode"), "change");
  assert.strictEqual($("#egCtlManual").classList.contains("hidden"), false);
  $("#egStart").value = "2018-12-22"; $("#egEnd").value = "2019-01-25"; $("#egAddBtn").click();
  $("#egStart").value = "2013-10-01"; $("#egEnd").value = "2013-10-17"; $("#egAddBtn").click();
  eq(QD.state.eventsTab.groupDraft.map((r) => r.start), ["2013-10-01", "2018-12-22"], "kept in date order");
  assert.ok($$("#egTable thead th").some((th) => th.textContent.includes("วันจบ")), "range shows an end-date column");
  assert.ok($$("#egTable tbody tr")[0].textContent.includes("17 วัน"), "length in calendar days");
  await QD.saveEventGroup(); await flush();
  const saved2 = calls.filter((c) => c[0] === "save_event_group").pop();
  assert.strictEqual(saved2[1].p_kind, "range");
  eq(saved2[1].p_rows[1], { start: "2018-12-22", end: "2019-01-25" });
  console.log("[ok] range group: manual entry, end-date column, length in days, payload carries start+end");

  // refuses a bad group without calling the RPC
  const before = calls.filter((c) => c[0] === "save_event_group").length;
  $("#egName").value = "";
  QD.setEventGroupDraft([{ start: "2024-01-01" }]);
  assert.strictEqual(await QD.saveEventGroup(), false);
  assert.ok($("#egError").textContent.includes("ชื่อกลุ่ม"));
  assert.strictEqual(calls.filter((c) => c[0] === "save_event_group").length, before, "nothing sent");
  console.log("[ok] builder refuses a group with no name / invalid rows before hitting the database");

  // ---------------- admin review ----------------
  await QD.loadAdminPendingGroups(); await flush();
  const panel = () => $("#adminPendingGroups").textContent;
  assert.ok(panel().includes("วันชาติสหรัฐฯ") && panel().includes("Government shutdown"), "both drafts listed");
  assert.ok(panel().includes("nop***@hotmail.com"), "masked creator shown");
  const gid = QD.state.eventsTab.pendingGroups[0].id;
  $(`[data-eg-toggle="${gid}"]`).click();
  assert.ok($$(`[data-egrow^="${gid}:"]`).length > 0, "rows visible after expanding");
  // fix a wrong date and save
  const cell = $(`[data-egrow="${gid}:0:start"]`);
  cell.value = "2030-01-01"; fire(cell, "change");
  await QD.saveAdminGroupEdits(gid); await flush();
  const adminSave = calls.filter((c) => c[0] === "save_event_group").pop();
  assert.strictEqual(adminSave[1].p_group_id, gid, "saved onto the same group");
  assert.ok(adminSave[1].p_rows.some((r) => r.start === "2030-01-01"), "edited date sent");
  // delete a row, then approve the whole group
  $(`[data-egrow-del="${gid}:0"]`).click();
  assert.strictEqual(QD.state.eventsTab.pendingGroups.find((g) => g.id === gid).rows.length,
    (adminSave[1].p_rows.length - 1), "row removed from the review list");
  await QD.approveEventGroup(gid); await flush();
  assert.ok(calls.some((c) => c[0] === "approve_event_group" && c[1].p_group_id === gid));
  assert.ok(!QD.state.eventsTab.pendingGroups.some((g) => g.id === gid), "approved group leaves the pending list");
  assert.ok($("#egMyGroups").textContent.includes("approved"), "now shows as approved in the group list");
  // reject = delete, with confirmation
  const other = QD.state.eventsTab.pendingGroups[0].id;
  assert.strictEqual(await QD.deleteEventGroup(other, "x", () => false), false, "cancel does nothing");
  assert.ok(!calls.some((c) => c[0] === "delete_event_group"), "no RPC on cancel");
  await QD.deleteEventGroup(other, "x", () => true); await flush();
  assert.ok(calls.some((c) => c[0] === "delete_event_group" && c[1].p_group_id === other));
  assert.strictEqual(QD.state.eventsTab.pendingGroups.length, 0);
  console.log("[ok] admin: expand, fix a date, save onto the same group, delete a row, approve all at once, reject with confirm");

  // ---------------- nothing leaks to non-admins ----------------
  QD.state.session = { user: { email: "someone@x.com" } };
  QD.state.eventsTab.pendingGroups = [];
  QD.renderAdminGroups();
  assert.ok($("#adminPendingGroups").textContent.includes("ไม่มีกลุ่ม"), "empty state for a non-admin view");
  console.log("[ok] empty states render");

  console.log("\nALL EVENT GROUP TESTS PASSED");
}
main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
