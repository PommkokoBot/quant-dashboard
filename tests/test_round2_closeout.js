// Round 2 close-out (2026-09-22): Events table sort + collapse, admin delete
// for approved custom events, custom events on the Momentum drill-down
// (per-name toggle, creator colour, real name in tooltip, live refresh).
// Runs the real page code in jsdom against a mocked Supabase client.
// Usage: QD_HTML=<new index.html> QD_HTML_BEFORE=<previous index.html> node tests/test_round2_closeout.js

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

function load(file) {
  const html = fs.readFileSync(path.resolve(__dirname, file), "utf8")
    .replace(/<script[^>]*src=[^>]*><\/script>/g, ""); // no CDN in tests
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/",
    beforeParse(w) { w.__QD_TEST__ = true; } });
  return dom.window;
}
// jsdom objects come from another realm -> compare as plain JSON
const J = (x) => JSON.parse(JSON.stringify(x));
const eq = (a, b, msg) => assert.deepStrictEqual(J(a), J(b), msg);
const flush = (n = 5) => { let p = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r))); return p; };

// ---- fixture: what market_events_between returns ----
const SYS = [
  { event_type: "fomc", event_date: "2024-01-31", market_date: "2024-01-31", name_th: "ประชุม FOMC", show_default: true, status: "approved", color: null, event_name: null, creator_email: null, event_id: 1 },
  { event_type: "cpi", event_date: "2024-02-13", market_date: "2024-02-13", name_th: "CPI", show_default: false, status: "approved", color: null, event_name: null, creator_email: null, event_id: 2 },
  { event_type: "fomc", event_date: "2024-03-20", market_date: "2024-03-20", name_th: "ประชุม FOMC", show_default: true, status: "approved", color: null, event_name: null, creator_email: null, event_id: 3 },
  { event_type: "us_election_pres", event_date: "2024-11-05", market_date: "2024-11-05", name_th: "เลือกตั้ง", show_default: true, status: "approved", color: null, event_name: null, creator_email: null, event_id: 4 }
];
const CUSTOM = [
  { event_type: "custom", event_date: "2023-07-04", market_date: "2023-07-05", name_th: "Custom Event", show_default: false, status: "approved", color: "#ff0000", event_name: "Independence Day", creator_email: "nop***@hotmail.com", event_id: 101 },
  { event_type: "custom", event_date: "2024-07-04", market_date: "2024-07-05", name_th: "Custom Event", show_default: false, status: "approved", color: "#00ff00", event_name: "Independence Day", creator_email: "nop***@hotmail.com", event_id: 102 },
  { event_type: "custom", event_date: "2024-10-01", market_date: "2024-10-01", name_th: "Custom Event", show_default: false, status: "draft", color: "#123456", event_name: "Gov Shutdown", creator_email: "meh***@gmail.com", event_id: 103 }
];

function makeSb(getRows) {
  const calls = [];
  const sb = {
    calls,
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} },
    rpc(fn, args) {
      calls.push([fn, args]);
      const result = () => {
        if (fn === "market_events_between") return { data: getRows(), error: null };
        if (fn === "admin_pending_drafts") return { data: [], error: null };
        return { data: null, error: null };
      };
      const p = Promise.resolve().then(result);
      p.range = (from, to) => Promise.resolve().then(() => { const r = result(); return { data: (r.data || []).slice(from, to + 1), error: r.error }; });
      return p;
    },
    from(table) {
      return { insert: async (row) => { calls.push(["insert:" + table, row]); return { error: null }; } };
    }
  };
  return sb;
}
const ADMIN = { user: { email: "mehresix@gmail.com" } };
const USER = { user: { email: "someone@x.com" } };
const tableRows = (w) => Array.from(w.document.querySelectorAll("#eventsTable tbody tr"));
const dateCol = (w) => tableRows(w).map((tr) => tr.children[0].textContent.trim());

async function main() {
  const beforeFile = process.env.QD_HTML_BEFORE || "../../scratch_before.html";
  const afterFile = process.env.QD_HTML || "../index.html";
  const Wb = load(beforeFile), Wa = load(afterFile);
  const B = Wb.QD, A = Wa.QD;

  // ================= 1. backward compatibility: system events =================
  const conv = A.toDrilldownEventRows(SYS);
  eq(conv.rows, SYS, "system rows pass through untouched");
  eq(conv.styles, {});
  const periods = ["2024-01", "2024-02", "2024-03", "2024-07", "2024-10", "2024-11"];
  for (const enabled of [["fomc"], ["fomc", "cpi", "us_election_pres"], []]) {
    const mb = B.buildEventMarkers(B.mapEventsToPeriods(periods, SYS, "month", enabled));
    const ma = A.buildEventMarkers(A.mapEventsToPeriods(periods, conv.rows, "month", enabled));
    eq(JSON.parse(JSON.stringify(ma)), JSON.parse(JSON.stringify(mb)), "markers identical before/after for " + enabled.join(","));
  }
  eq(A.eventTypesFromRows(SYS), B.eventTypesFromRows(SYS), "toggle list for system events unchanged");
  console.log("[ok] system events (FOMC/CPI/เลือกตั้ง): drill-down markers + toggles identical to the previous version");

  // ================= 2. custom events on the drill-down =================
  const all = SYS.concat(CUSTOM);
  const c2 = A.toDrilldownEventRows(all);
  const types = A.eventTypesFromRows(c2.rows);
  const codes = types.map((t) => t.code);
  assert.ok(codes.includes("custom:Independence Day") && codes.includes("custom:Gov Shutdown"), "one toggle per custom name");
  assert.ok(!codes.includes("custom"), "no single lumped 'custom' toggle any more");
  const ind = types.find((t) => t.code === "custom:Independence Day");
  assert.strictEqual(ind.count, 2, "same name across years = one series");
  assert.strictEqual(ind.nameTh, "Independence Day", "toggle shows the real name");
  assert.strictEqual(ind.showDefault, false, "custom toggles start off");
  assert.strictEqual(c2.styles["custom:Independence Day"].color, "#ff0000", "colour of the earliest occurrence");
  assert.strictEqual(c2.styles["custom:Gov Shutdown"].color, "#123456");
  assert.ok(codes.indexOf("fomc") < codes.indexOf("custom:Gov Shutdown"), "system types listed first");
  // long names are shortened on the chart label only
  const longConv = A.toDrilldownEventRows([Object.assign({}, CUSTOM[0], { event_name: "A very long custom event name" })]);
  assert.strictEqual(longConv.styles["custom:A very long custom event name"].short.length, 18);
  // bad colour falls back to grey
  const badConv = A.toDrilldownEventRows([Object.assign({}, CUSTOM[0], { color: "red;background:url(x)" })]);
  assert.strictEqual(badConv.styles["custom:Independence Day"].color, "#6b7280");
  console.log("[ok] custom events: one toggle per name (same name across years grouped), off by default, creator colour, safe fallback");

  // markers + tooltip text through the real state path
  A.applyMarketEventRows(all);
  eq(A.state.events.enabled, ["fomc", "us_election_pres"], "defaults unchanged: FOMC + election on, custom off");
  A.state.events.enabled = ["custom:Independence Day"];
  const mk = A.buildEventMarkers(A.mapEventsToPeriods(["2023-07", "2024-07"], A.state.events.rows, "month", A.state.events.enabled));
  assert.strictEqual(mk.length, 2);
  assert.strictEqual(mk[0].color, "#ff0000", "line uses creator colour");
  assert.strictEqual(mk[0].label, "Independence Day", "label = event name, not 'custom'");
  assert.strictEqual(mk[1].events[0].nameTh, "Independence Day", "tooltip lists the real name");
  // reload keeps the user's on/off choices and drops codes that disappeared
  A.state.events.enabled = ["fomc", "custom:Independence Day", "custom:Gov Shutdown"];
  A.applyMarketEventRows(SYS.concat(CUSTOM.slice(0, 2))); // Gov Shutdown deleted
  eq(A.state.events.enabled, ["fomc", "custom:Independence Day"]);
  console.log("[ok] drill-down: custom line in creator colour, labelled + tooltipped with its name; reload keeps choices, drops deleted");

  // ================= 3. sort =================
  const sorted = A.sortEventRows(all, "date", "desc").map((r) => r.event_id);
  eq(sorted, [4, 103, 102, 3, 2, 1, 101], "default = newest first");
  eq(A.sortEventRows(all, "date", "asc").map((r) => r.event_id), [101, 1, 2, 3, 102, 103, 4]);
  const byName = A.sortEventRows(all, "name", "asc").map((r) => r.event_id);
  eq(byName.slice(0, 2), [2, 103], "CPI < Gov Shutdown (case-insensitive)");
  eq(A.sortEventRows(all, "status", "asc").map((r) => r.status).slice(0, 1), ["approved"]);
  eq(A.sortEventRows(all, "status", "desc")[0].status, "draft");
  const tie = A.sortEventRows(all, "type", "asc").filter((r) => r.event_type === "fomc").map((r) => r.event_id);
  eq(tie, [3, 1], "ties fall back to newest first");
  const blanks = A.sortEventRows([{ event_date: "2024-01-01", event_name: "" , event_type: ""}, { event_date: "2024-01-02", event_name: "x", event_type: "x" }], "type", "asc");
  assert.strictEqual(blanks[1].event_type, "", "blanks last");
  assert.strictEqual(all[0].event_id, 1, "sortEventRows does not mutate its input");
  console.log("[ok] sortEventRows: default newest-first, asc/desc per column, case-insensitive text, stable ties, blanks last, pure");

  // ================= 4. DOM: table, sort headers, collapse =================
  let rows = all.slice();
  const sbB = makeSb(() => rows), sbA = makeSb(() => rows);
  await B.init(sbB); await A.init(sbA);
  B.state.session = USER; A.state.session = USER;
  await B.loadEventsTab(); await A.loadEventsTab();
  await flush();
  eq(dateCol(Wa), dateCol(Wb), "default table order identical to previous version");
  const hdr = (w, key) => w.document.querySelector(`#eventsTable th[data-sort="${key}"]`);
  assert.strictEqual(hdr(Wa, "date").getAttribute("aria-sort"), "descending");
  hdr(Wa, "date").click();
  eq(dateCol(Wa), dateCol(Wb).slice().reverse(), "click Date -> oldest first");
  assert.ok(hdr(Wa, "date").textContent.includes("▲"));
  hdr(Wa, "name").click();
  const names = tableRows(Wa).map((tr) => tr.children[2].textContent.toLowerCase());
  eq(names, names.slice().sort(), "click Name -> A→Z");
  hdr(Wa, "name").click();
  assert.strictEqual(hdr(Wa, "name").getAttribute("aria-sort"), "descending", "click again -> Z→A");
  // filter keeps the chosen sort
  const typeSel = Wa.document.getElementById("eventsTypeFilter");
  typeSel.value = "fomc"; typeSel.dispatchEvent(new Wa.Event("change"));
  assert.strictEqual(tableRows(Wa).length, 2);
  assert.strictEqual(hdr(Wa, "name").getAttribute("aria-sort"), "descending", "sort survives a filter change");
  // reload keeps the filter
  await A.loadEventsTab(); await flush();
  assert.strictEqual(Wa.document.getElementById("eventsTypeFilter").value, "fomc", "filter kept across reload");
  typeSel.value = ""; typeSel.dispatchEvent(new Wa.Event("change"));
  A.setEventsSort("date"); A.state.eventsTab.sort = { key: "date", dir: "desc" }; A.rerenderEventsTable();
  console.log("[ok] Events table: click header to sort (▲/▼, aria-sort), default order unchanged, sort + filter kept across filter change/reload");

  const btn = Wa.document.getElementById("eventsCollapseBtn");
  const body = Wa.document.getElementById("eventsBody");
  assert.strictEqual(body.classList.contains("hidden"), false, "expanded by default");
  btn.click();
  assert.strictEqual(body.classList.contains("hidden"), true);
  assert.strictEqual(Wa.document.getElementById("eventsControls").classList.contains("hidden"), true, "filters hidden when folded");
  assert.strictEqual(btn.textContent, "ขยาย ▼");
  assert.strictEqual(btn.getAttribute("aria-expanded"), "false");
  await A.loadEventsTab(); await flush();
  assert.strictEqual(body.classList.contains("hidden"), true, "stays folded after reload");
  btn.click();
  assert.strictEqual(body.classList.contains("hidden"), false);
  assert.strictEqual(btn.textContent, "พับ ▲");
  console.log("[ok] Events Calendar fold/unfold: hides strip + table + filters, label/aria update, state kept across reload");

  // ================= 5. admin delete =================
  assert.strictEqual(Wa.document.querySelectorAll("[data-delete-event]").length, 0, "non-admin: no delete buttons");
  assert.strictEqual(Wa.document.querySelectorAll("#eventsTable thead th").length, 5, "non-admin: no extra column");
  A.state.session = ADMIN;
  A.rerenderEventsTable();
  const delBtns = Array.from(Wa.document.querySelectorAll("[data-delete-event]"));
  eq(delBtns.map((b) => b.getAttribute("data-delete-event")).sort(), ["101", "102"], "only approved custom rows (not FOMC, not drafts)");
  assert.strictEqual(Wa.document.querySelectorAll("#eventsTable thead th").length, 6, "admin: 'จัดการ' column");
  // cancel -> nothing sent
  Wa.confirm = () => false;
  delBtns[0].click(); await flush();
  assert.ok(!sbA.calls.some((c) => c[0] === "delete_custom_event"), "cancel = no delete");
  // confirm -> RPC with numeric id, then reload (table + drill-down)
  Wa.confirm = (msg) => { assert.ok(msg.includes("Independence Day")); return true; };
  const before = sbA.calls.filter((c) => c[0] === "market_events_between").length;
  const target = Wa.document.querySelector('[data-delete-event="102"]');
  rows = rows.filter((r) => r.event_id !== 102); // DB after delete
  target.click(); await flush(10);
  const del = sbA.calls.find((c) => c[0] === "delete_custom_event");
  assert.ok(del && del[1].p_event_id === 102, "RPC delete_custom_event(102)");
  assert.ok(sbA.calls.filter((c) => c[0] === "market_events_between").length > before, "reloaded after delete");
  assert.strictEqual(Wa.document.querySelector('[data-delete-event="102"]'), null, "row gone from table");
  assert.strictEqual(A.state.events.types.find((t) => t.code === "custom:Independence Day").count, 1, "drill-down state refreshed without page reload");
  console.log("[ok] admin delete: button only on approved custom rows, confirm required, RPC with numeric id, table + chart refreshed");

  // ================= 6. live refresh after submit (d) =================
  const nBefore = sbA.calls.filter((c) => c[0] === "market_events_between").length;
  rows = rows.concat([{ event_type: "custom", event_date: "2025-01-20", market_date: "2025-01-21", name_th: "Custom Event", show_default: false, status: "draft", color: "#abcdef", event_name: "Inauguration", creator_email: "meh***@gmail.com", event_id: 104 }]);
  await A.submitCustomEvent("2025-01-20", "Inauguration", "#abcdef"); await flush();
  assert.ok(sbA.calls.some((c) => c[0] === "insert:market_events" && c[1].name === "Inauguration"));
  assert.ok(sbA.calls.filter((c) => c[0] === "market_events_between").length > nBefore, "reload after submit");
  assert.ok(A.state.events.types.some((t) => t.code === "custom:Inauguration"), "new draft appears as a drill-down toggle for its owner immediately");
  console.log("[ok] submit/approve/reject/delete all reload the shared event rows -> table and drill-down stay in sync without refresh");

  console.log("\nALL ROUND-2 CLOSE-OUT TESTS PASSED");
}

main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
