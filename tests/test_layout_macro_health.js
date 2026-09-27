// 2026-09-22: Events Calendar is always the last section of the Events tab;
// Data Health freshness rules for the 10 new FRED series.
// Usage: QD_HTML=<index.html> node tests/test_layout_macro_health.js

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.resolve(__dirname, process.env.QD_HTML || "../index.html"), "utf8")
  .replace(/<script[^>]*src=[^>]*><\/script>/g, "");
const w = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/",
  beforeParse(win) { win.__QD_TEST__ = true; } }).window;
const QD = w.QD;

// ---- layout ----
const tab = w.document.getElementById("tabEvents");
const sections = Array.from(tab.children).filter((el) => el.tagName === "SECTION");
const ids = sections.map((s) => s.id || (s.querySelector("#seasonalChart") ? "seasonal" : s.querySelector("#eventsTable") ? "calendar" : "?"));
assert.strictEqual(sections[sections.length - 1].querySelector("#eventsTable") !== null, true, "Events Calendar is the last section");
assert.ok(ids.indexOf("customEventSection") < ids.length - 1 && ids.indexOf("adminEventSection") < ids.length - 1);
assert.ok(sections[0].querySelector("#seasonalChart"), "Seasonal stays first");
assert.ok(w.document.getElementById("eventsCollapseBtn") && w.document.getElementById("eventsBody"), "collapse controls moved with it");
console.log("[ok] Events tab order: Seasonal → Custom Event → Admin → Events Calendar (last) · " + ids.join(" → "));

// ---- Data Health freshness ----
const today = "2026-09-22";
const c = (id, last) => QD.classifyMacroHealth({ series_id: id, last_date: last }, today);
const NEW = ["DGS2", "DGS30", "T10Y2Y", "T5YIE", "T10YIE", "T5YIFR", "MICH", "NFCI", "STLFSI4", "GDPNOW"];
NEW.forEach((id) => assert.ok(QD.MACRO_SERIES_INFO[id], id + " has a freshness rule"));
// values as they are on FRED today
assert.strictEqual(c("DGS2", "2026-09-18").status, "ok", "daily, 4 days old (weekend)");
assert.strictEqual(c("T10Y2Y", "2026-09-21").status, "ok");
assert.strictEqual(c("NFCI", "2026-09-11").status, "ok", "weekly, dated Friday, published next week");
assert.strictEqual(c("STLFSI4", "2026-09-11").status, "ok");
assert.strictEqual(c("MICH", "2026-07-01").status, "ok", "FRED posts MICH ~1 month late");
assert.strictEqual(c("GDPNOW", "2026-07-01").status, "ok", "Q3 nowcast dated 1 Jul");
assert.strictEqual(QD.classifyMacroHealth({ series_id: "GDPNOW", last_date: "2026-07-01" }, "2026-10-25").status, "ok", "before the Q4 nowcast starts");
// genuinely stale data is still caught
assert.strictEqual(c("DGS2", "2026-09-10").status, "warn", "daily 12 days old");
assert.strictEqual(c("NFCI", "2026-08-28").status, "warn", "weekly 25 days old");
assert.strictEqual(QD.classifyMacroHealth({ series_id: "GDPNOW", last_date: "2026-07-01" }, "2026-11-20").status, "warn", "Q4 nowcast should exist by late Nov");
// existing four unchanged
assert.deepStrictEqual(JSON.parse(JSON.stringify(["DGS10", "FEDFUNDS", "CPIAUCSL", "UNRATE"].map((k) => QD.MACRO_SERIES_INFO[k].maxAgeDays))), [7, 70, 70, 70]);
assert.strictEqual(c("CPIAUCSL", "2026-07-01").status, "warn", "CPI stuck at July is still flagged (the bug this round fixes)");
assert.strictEqual(c("CPIAUCSL", "2026-08-01").status, "ok", "…and clears once August arrives");
console.log("[ok] Data Health: freshness rules for 10 new FRED series (daily 7d, weekly 14d, MICH 100d, GDPNow 125d); old four unchanged");
console.log("\nALL LAYOUT + MACRO HEALTH TESTS PASSED");
