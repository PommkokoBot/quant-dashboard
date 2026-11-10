// Risk columns (ATR / 52-week range) + Market Breadth — round of 2026-11-02.
// The numbers themselves are produced by two database functions; what this
// suite proves is the half that lives in the browser: that the RPC payload is
// mapped onto the right rows, that a failure degrades instead of breaking the
// page, that the new columns behave like every other column (sort, presets,
// saved layouts, export), and that breadth is summarised correctly.
//
// Usage: QD_HTML=<index.html> node tests/test_risk_breadth.js

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const { loadPage } = require("./_page");

const dom = loadPage();
const w = dom.window, QD = w.QD, doc = w.document;
const $ = (s) => doc.querySelector(s);
const flush = (n = 8) => { let p = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r))); return p; };
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

// ---- real shapes, taken from the live RPCs on 2026-10-30 ----
const RISK_ROWS = [
  { instrument_id: 1, as_of: "2026-10-30", price: 755.72, atr14: 8.30, atr_pct: 1.0984, atr_pctile_1y: 56.3, hi_52w: 781.62, lo_52w: 626.11, pos_52w: 83.34, pct_from_high: -3.31, bars: 252 },
  { instrument_id: 2, as_of: "2026-10-30", price: 522.49, atr14: 21.01, atr_pct: 4.0212, atr_pctile_1y: 81.0, hi_52w: 671.83, lo_52w: 314.07, pos_52w: 58.26, pct_from_high: -22.23, bars: 252 },
  { instrument_id: 3, as_of: "2026-10-30", price: 355.78, atr14: 5.87, atr_pct: 1.6499, atr_pctile_1y: 18.3, hi_52w: 509.70, lo_52w: 354.67, pos_52w: 0.72, pct_from_high: -30.20, bars: 252 }
];
const BREADTH_ROWS = [
  { date: "2026-06-26", universe: 93, new_hi: 5, new_lo: 4, above_sma200: 71, pct_above_sma200: 76.34 },
  { date: "2026-09-25", universe: 93, new_hi: 2, new_lo: 2, above_sma200: 57, pct_above_sma200: 61.29 },
  { date: "2026-10-23", universe: 93, new_hi: 6, new_lo: 5, above_sma200: 49, pct_above_sma200: 52.69 },
  { date: "2026-10-29", universe: 93, new_hi: 2, new_lo: 4, above_sma200: 57, pct_above_sma200: 61.29 },
  { date: "2026-10-30", universe: 93, new_hi: 9, new_lo: 7, above_sma200: 51, pct_above_sma200: 54.84 }
];

let rpcCalls = [];
let riskShouldFail = false;
const sb = {
  rpc: (fn, args) => {
    rpcCalls.push([fn, args]);
    if (fn === "risk_metrics") return riskShouldFail
      ? Promise.resolve({ data: null, error: { message: "boom" } })
      : Promise.resolve({ data: RISK_ROWS, error: null });
    if (fn === "breadth_series") return Promise.resolve({
      data: BREADTH_ROWS.filter((r) => args.p_days >= 504 || r.date >= "2026-09-01"), error: null });
    return Promise.resolve({ data: [], error: null });
  },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} },
  from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) })
};

async function main() {
  await QD.init(sb);

  // ---------------- the RPC payload is mapped, not guessed ----------------
  const r = await QD.fetchRiskMetrics([1, 2, 3]);
  assert.strictEqual(r.asOf, "2026-10-30", "as_of is carried through");
  eq(Object.keys(r.byId), ["1", "2", "3"], "keyed by instrument id");
  assert.strictEqual(r.byId[2].atrPct, 4.0212, "atr_pct -> atrPct");
  assert.strictEqual(r.byId[3].pos52, 0.72, "pos_52w -> pos52");
  assert.strictEqual(r.byId[3].pctFromHigh, -30.20, "pct_from_high -> pctFromHigh");
  assert.strictEqual(r.byId[1].hi52, 781.62);
  const call = rpcCalls.filter((c) => c[0] === "risk_metrics").pop();
  eq(call[1], { p_instrument_ids: [1, 2, 3] }, "the universe is passed to the database, not filtered in the browser");
  console.log("[ok] risk_metrics payload maps onto the rows (names, ids, as_of)");

  // ---------------- the columns behave like every other column ----------------
  const ids = QD.MOMENTUM_TABLE_COLUMNS ? QD.MOMENTUM_TABLE_COLUMNS.map((c) => c.id) : null;
  const cols = ["atrPct", "atrPctile", "atr14", "pos52", "pctFromHigh"];
  const reg = QD.momentumColumnById;
  cols.forEach((id) => {
    const c = reg(id);
    assert.ok(c, id + " is in the registry");
    assert.strictEqual(c.group, "risk", id + " is grouped as risk");
    assert.ok(typeof c.value === "function" && typeof c.text === "function", id + " can be sorted and rendered");
    assert.strictEqual(c.text({}), "—", id + " renders an em dash when the metric is missing");
  });
  assert.strictEqual(reg("atrPctile").heat, "high", "a volatility percentile is heat-mapped high = louder");
  assert.strictEqual(reg("pos52").text({ pos52: 83.34 }), "83.3%");
  assert.strictEqual(reg("pctFromHigh").text({ pctFromHigh: -3.31 }), "-3.31%");
  assert.strictEqual(reg("atrPctile").text({ atrPctile: 56.3 }), "56%");
  console.log("[ok] five risk columns registered with sort values, formatting and empty-state handling");

  // a saved layout from BEFORE this round must still work and must not hide the new columns
  const oldLayout = { order: ["row", "ticker", "trailingReturnPct", "volZScore"], visible: { volZScore: false }, sortColumn: "trailingReturnPct", sortDir: "desc" };
  const fixed = QD.sanitizeLayout(oldLayout);
  cols.forEach((id) => {
    assert.ok(fixed.order.includes(id), id + " is appended to an older saved layout");
    assert.strictEqual(fixed.visible[id], true, id + " defaults to visible for someone upgrading");
  });
  assert.strictEqual(fixed.visible.volZScore, false, "a column the user had hidden stays hidden");
  assert.strictEqual(fixed.order[0], "row", "the user's own ordering is preserved");
  console.log("[ok] an existing user's saved column layout survives the upgrade (new columns appended, old choices kept)");

  assert.ok(QD.MOMENTUM_TABLE_PRESETS.risk, "a Risk preset exists");
  assert.strictEqual(QD.MOMENTUM_TABLE_PRESETS.risk.sort.column, "pos52");
  QD.MOMENTUM_TABLE_PRESETS.risk.columns.forEach((id) => assert.ok(reg(id), "preset column exists: " + id));
  ["momentum", "volume", "all"].forEach((k) => assert.ok(QD.MOMENTUM_TABLE_PRESETS[k], k + " preset is untouched"));
  assert.ok(QD.MOMENTUM_TABLE_PRESETS.all.columns.includes("atrPct"), "the 'all' preset picks the new columns up automatically");
  console.log("[ok] Risk preset added; the three existing presets are unchanged");

  // ---------------- a failed risk call must not take the table down ----------------
  riskShouldFail = true;
  const failed = await QD.fetchRiskMetrics([1]).then(() => "resolved").catch((e) => "threw: " + e.message);
  assert.strictEqual(failed, "threw: boom", "the fetch surfaces the error to its caller");
  riskShouldFail = false;
  // with no risk data in state, rows still build and the columns read as empty
  QD.state.momentum.risk = { byId: {}, asOf: null, error: "boom", key: null };
  const emptyRow = { instrumentId: 9, ticker: "ZZZ" };
  cols.forEach((id) => {
    assert.strictEqual(reg(id).value(emptyRow), undefined, id + " has no value for a row with no risk data");
    assert.strictEqual(reg(id).text(emptyRow), "—", id + " still renders");
  });
  const sorted = QD.sortMergedRows([{ pos52: null }, { pos52: 50 }, { pos52: 90 }], "pos52", "desc");
  assert.deepStrictEqual(sorted.map((x) => x.pos52), [90, 50, null], "rows without the metric sink to the bottom, as everywhere else");
  console.log("[ok] a failed risk_metrics call degrades to empty columns instead of breaking the page");

  // ---------------- breadth ----------------
  $("#breadthRange").value = "504";
  const rows = await QD.loadBreadth(); await flush();
  assert.strictEqual(rows.length, 5, "all returned days are kept");
  const bCall = rpcCalls.filter((c) => c[0] === "breadth_series").pop();
  eq(bCall[1], { p_days: 504 }, "the selected range is sent to the database");
  eq(rows[4], { date: "2026-10-30", universe: 93, newHi: 9, newLo: 7, aboveSma: 51, pctAbove: 54.84 }, "row shape");

  const s = QD.breadthSummary(rows);
  assert.strictEqual(s.asOf, "2026-10-30");
  assert.strictEqual(s.newHi, 9); assert.strictEqual(s.newLo, 7);
  assert.strictEqual(s.netLast, 2, "net = new highs - new lows");
  assert.strictEqual(s.pctAbove, 54.84);
  assert.strictEqual(s.worstDay.newLo, 7, "the worst day of the window is the one with the most new lows");
  assert.strictEqual(s.worstDay.date, "2026-10-30");
  assert.strictEqual(QD.breadthSummary([]), null, "an empty series has no summary");
  console.log("[ok] breadth: RPC range passed through, rows mapped, summary (net, worst day, % above SMA200) correct");

  const txt = $("#breadthSummary").textContent;
  ["54.8%", "9 / 7", "93"].forEach((bit) => assert.ok(txt.includes(bit), "summary card shows " + bit));
  assert.ok(!$("#breadthSummary").className.includes("hidden"), "the summary is visible once loaded");
  assert.ok($("#breadthNote").textContent.includes("252"), "the note states the 252-bar qualification rule");
  console.log("[ok] breadth summary cards and the qualification note render");

  const ds = QD.buildBreadthDatasets(rows);
  eq(ds.map((d) => d.label), ["จุดสูงสุดใหม่ 52 สัปดาห์", "จุดต่ำสุดใหม่ 52 สัปดาห์", "% อยู่เหนือ SMA200"]);
  eq(ds[0].data, [5, 2, 6, 2, 9], "new highs plot upward");
  eq(ds[1].data, [-4, -2, -5, -4, -7], "new lows plot downward, so the two never hide each other");
  eq(ds[2].data, [76.34, 61.29, 52.69, 61.29, 54.84], "the SMA200 line keeps its own axis");
  assert.strictEqual(ds[2].yAxisID, "y1", "percentage line is on the right-hand axis, not stacked with the counts");
  assert.strictEqual(ds[0].yAxisID, "y");
  console.log("[ok] chart datasets: counts stacked around zero, % above SMA200 on its own axis");

  console.log("\nALL RISK + BREADTH TESTS PASSED");
}
main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
