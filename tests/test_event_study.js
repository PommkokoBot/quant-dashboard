// Event Study engine (round 3A block 2), re-created 2026-10-30 — the original
// suite was written in September but never pushed, so Event Study sat in the
// repo with no test at all.
//
// Hand-checkable fixtures first (a wrong number is obvious), then the wiring.
// The companion file tests/test_event_study_real.js checks the same engine
// against real SPY data with expected values computed in Postgres.
//
// Usage: QD_HTML=<index.html> node tests/test_event_study.js

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
const near = (a, b, m, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b})`);

// ---------------- fixture: +1 % every trading day, Mon-Fri ----------------
// close(i) = 100 * 1.01^i  ->  a k-day return is always (1.01^k - 1) * 100 no
// matter which event it is measured from. Any deviation = a mis-anchored window.
function weekdays(startISO, n) {
  const out = [];
  let d = new Date(startISO + "T00:00:00Z");
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
const RISING = QD.buildPriceIndex(weekdays("2020-01-01", 400).map((date, i) => ({ date, close: 100 * Math.pow(1.01, i) })));
const pctK = (k) => (Math.pow(1.01, k) - 1) * 100;

async function main() {
  // ---------------- price index + anchoring ----------------
  assert.strictEqual(RISING.dates.length, 400, "400 weekday bars");
  assert.strictEqual(RISING.dates[QD.tradingIndexOnOrBefore(RISING, "2020-01-04")], "2020-01-03",
    "a Saturday event anchors on the Friday close, not the Monday after");
  assert.strictEqual(RISING.dates[QD.tradingIndexOnOrBefore(RISING, "2020-01-06")], "2020-01-06", "a trading day anchors on itself");
  assert.strictEqual(QD.tradingIndexOnOrBefore(RISING, "2019-12-31"), -1, "a date before the first bar has no anchor");
  eq(QD.buildPriceIndex([{ date: "2020-01-01", close: 10, adj_close: 5 }]).closes, [5], "adj_close wins over close");
  eq(QD.buildPriceIndex([{ date: "2020-01-01", close: 0 }, { date: "not-a-date", close: 5 }]).closes, [], "junk rows dropped");
  console.log("[ok] price index: adj_close preferred, junk dropped, a holiday anchors on the previous session");

  // ---------------- anchors, gaps, hard cap ----------------
  const evs = ["2020-02-03", "2020-03-02", "2020-04-01"].map((d) => ({ start: d }));
  const an = QD.eventAnchors(RISING, evs, "point");
  assert.strictEqual(an.anchors.length, 3);
  assert.strictEqual(an.dropped.length, 0);
  const gaps = [an.anchors[1].i0 - an.anchors[0].i1, an.anchors[2].i0 - an.anchors[1].i1];
  const gap = QD.eventGapStats(an.anchors);
  assert.strictEqual(gap.n, 2, "3 events -> 2 gaps");
  assert.strictEqual(gap.min, Math.min(...gaps));
  assert.strictEqual(gap.max, Math.max(...gaps));
  assert.strictEqual(gap.med, Math.round((gaps[0] + gaps[1]) / 2), "gap measured in trading days, end -> next start");
  assert.strictEqual(QD.capFromGaps(gap), gap.med - 1, "cap = median gap - 1, so a window never reaches the next event");
  assert.strictEqual(QD.capFromGaps({ med: null }), QD.ES_MAX_N, "a single event has no neighbour, so no cap");
  assert.strictEqual(QD.capFromGaps({ med: 2 }), QD.ES_MIN_N, "the cap never drops below the minimum N");
  assert.strictEqual(QD.eventAnchors(RISING, [{ start: "1990-01-01" }], "point").dropped.length, 1, "an event before the price history is dropped");
  const future = QD.eventAnchors(RISING, [{ start: "2099-01-01" }, { start: RISING.dates[10] }], "point");
  eq(future.dropped, ["2099-01-01"], "a scheduled-but-not-yet-happened event is dropped, not anchored on the last bar");
  assert.strictEqual(future.anchors.length, 1);
  console.log("[ok] anchors, gap statistics, hard cap, and the future-event guard");

  // ---------------- point study ----------------
  const res = QD.computeEventStudy(RISING, evs, { kind: "point", n: 10 });
  assert.strictEqual(res.labels.length, 21, "-10..+10 = 21 columns");
  eq([res.labels[0], res.labels[10], res.labels[20]], ["-10", "วันเกิดเหตุ", "+10"]);
  near(res.med[10], 0, "day 0 is exactly 0 %");
  near(res.med[20], pctK(10), "+10 days compounds to 1.01^10 - 1");
  near(res.med[0], pctK(-10), "-10 days is the same compounding backwards");
  near(res.mean[15], pctK(5), "mean equals median when every event behaves identically");
  near(res.p25[15], res.p75[15], "no spread in this fixture");
  assert.ok(res.nAt.every((n) => n === 3), "all three events contribute to every column");
  assert.strictEqual(res.boundaries[0], 10, "the day-0 marker sits on the middle column");
  near(res.baseline[20], pctK(10), "on a constant-drift series the baseline equals the event line");
  assert.strictEqual(res.n, 10);
  console.log("[ok] point study: 0 % at day 0, exact compounding both directions, n(t), baseline");

  const late = QD.computeEventStudy(RISING, [{ start: RISING.dates[395] }, { start: RISING.dates[100] }], { kind: "point", n: 10 });
  assert.strictEqual(late.nAt[10], 2, "both events have a day 0");
  assert.strictEqual(late.nAt[20], 1, "only one of them reaches +10");
  console.log("[ok] n(t) decays where the price history runs out instead of inventing values");

  // ---------------- range study ----------------
  const rEvents = [
    { start: RISING.dates[50], end: RISING.dates[55] },   // 5 trading days long
    { start: RISING.dates[200], end: RISING.dates[209] }  // 9 trading days long
  ];
  const rr = QD.computeEventStudy(RISING, rEvents, { kind: "range", n: 5, duringMode: "raw" });
  eq(rr.duration, { min: 5, med: 7, max: 9 }, "duration statistics in trading days");
  assert.strictEqual(rr.duringLen, 5, "raw mode truncates the during block at the shortest event");
  assert.strictEqual(rr.labels.length, 6 + 5 + 5, "before(-5..0) + during(1..5) + after(+1..+5)");
  eq([rr.labels[5], rr.labels[6], rr.labels[11]], ["เริ่ม", "วันที่ 1", "+1"]);
  eq(rr.boundaries, [5, 10], "start and end boundary columns");
  near(rr.med[5], 0, "0 % at the start of the event");
  near(rr.med[10], pctK(5), "the during block ends 5 trading days of drift later");
  near(rr.med[11] - rr.med[10], pctK(1), "the after block continues the line instead of restarting at 0");
  near(rr.med[15], pctK(5) + pctK(5), "joined level at +5");
  console.log("[ok] range study: before → during → after joined into one continuous line");

  const rn = QD.computeEventStudy(RISING, rEvents, { kind: "range", n: 5, duringMode: "norm" });
  assert.strictEqual(rn.duringLen, QD.ES_NORM_STEPS);
  eq([rn.labels[6], rn.labels[25]], ["5%", "100%"]);
  eq(rn.boundaries, [5, 25]);
  assert.ok(rn.med[25] > pctK(5) && rn.med[25] < pctK(9),
    "the 100 % column sits between the short and the long event's own ending level");
  console.log("[ok] range study: 0–100 % normalised during block");

  assert.strictEqual(QD.computeEventStudy(RISING, rEvents, { kind: "range", n: 5, duringMode: "raw", minDur: 6 }).nEvents, 1, "duration filter drops the 5-day event");
  assert.strictEqual(QD.computeEventStudy(RISING, rEvents, { kind: "range", n: 5, duringMode: "raw", minDur: 6 }).duringLen, 9, "only the 9-day event is left");
  assert.strictEqual(QD.computeEventStudy(RISING, rEvents, { kind: "range", n: 5, maxDur: 4 }).nEvents, 0, "filtering everything out returns an empty result instead of crashing");
  console.log("[ok] duration filter");

  // ---------------- statistics on an uneven series ----------------
  const closes = [100, 110, 99, 99, 120, 90, 100, 105, 130, 95, 100, 100.5, 101, 99.5, 100];
  const dates = weekdays("2021-01-04", closes.length);
  const shaped = QD.buildPriceIndex(closes.map((c, i) => ({ date: dates[i], close: c })));
  const st = QD.esColumnStats([1, 2, 3, 4]);
  near(st.med, 2.5, "median of four values"); near(st.mean, 2.5, "mean");
  near(st.p25, 1.75, "p25 interpolated the same way as the Seasonality engine"); near(st.p75, 3.25, "p75");
  eq([st.min, st.max, st.n], [1, 4, 4]);
  assert.strictEqual(QD.esColumnStats([]).n, 0, "an empty column reports n = 0, not a fake value");
  const three = QD.computeEventStudy(shaped, [{ start: shaped.dates[2] }, { start: shaped.dates[6] }, { start: shaped.dates[10] }], { kind: "point", n: 1 });
  assert.strictEqual(three.n, QD.ES_MIN_N, "an N below the floor is raised to the minimum");
  const p1 = three.labels.indexOf("+1");
  // +1 day returns: 99->99 = 0 %, 100->105 = 5 %, 100->100.5 = 0.5 %
  near(three.med[p1], 0.5, "median of the three +1 returns");
  near(three.mean[p1], (0 + 5 + 0.5) / 3, "mean of the three +1 returns");
  near(three.p25[p1], 0.25, "p25 of {0, 0.5, 5}");
  near(three.min[p1], 0, "min"); near(three.max[p1], 5, "max");
  console.log("[ok] per-column statistics (median / mean / p25 / p75 / min / max) on an uneven series");

  // ---------------- UI wiring ----------------
  const rows = [
    { event_type: "fomc", event_date: RISING.dates[20], name_th: "FOMC", color: "#dc2626" },
    { event_type: "fomc", event_date: RISING.dates[60], name_th: "FOMC", color: "#dc2626" },
    { event_type: "fomc", event_date: RISING.dates[100], name_th: "FOMC", color: "#dc2626" },
    { event_type: "custom", event_date: RISING.dates[30], group_id: 7, group_name: "Shutdown", color: "#7c3aed", end_date: RISING.dates[34] },
    { event_type: "custom", event_date: RISING.dates[150], group_id: 7, group_name: "Shutdown", color: "#7c3aed", end_date: RISING.dates[158] },
    { event_type: "custom", event_date: RISING.dates[200], name_th: "one-off" }
  ];
  const srcs = QD.esSourcesFromRows(rows);
  eq(srcs.map((s) => s.key), ["t:fomc", "g7"], "one source per system type + one per group; an ungrouped custom event is not a source");
  eq(srcs.map((s) => s.kind), ["point", "range"], "a group carrying end dates is a range source");

  QD.state.instruments = [{ id: 1, ticker: "SPY", name: "SPDR S&P 500" }];
  QD.state.assetId = 1;
  QD.state.eventsTab.customEvents = rows;
  QD.state.eventStudy.pricesByAsset[1] = RISING;   // no network in tests
  QD.renderEsPickers();
  assert.strictEqual($("#esSource").options.length, 2, "both sources offered");
  assert.ok($("#esDuringBox").className.includes("hidden"), "during controls stay hidden for a point source");

  $("#esN").value = "200";
  const capped = await QD.runEventStudy(); await flush();
  assert.strictEqual(capped.gap.med, 40, "the FOMC fixture sits 40 trading days apart");
  assert.strictEqual(QD.state.eventStudy.n, 39, "N is clamped to the cap (40 - 1)");
  assert.strictEqual($("#esN").value, "39", "and the input shows the clamped value, so the number on screen is the number used");
  assert.ok(!$("#esCapWarn").className.includes("hidden") && $("#esCapWarn").textContent.includes("39"), "the cap explains itself");

  $("#esUnlock").checked = true; $("#esN").value = "60";
  const over = await QD.runEventStudy(); await flush();
  assert.strictEqual(over.n, 60, "ticking 'accept overlap' lets the longer window through");
  assert.ok($("#esCapWarn").textContent.includes("ทับซ้อน"), "and warns that windows now overlap");
  $("#esUnlock").checked = false;
  console.log("[ok] UI: sources built from the loaded rows, hard cap clamps N, overlap unlock with its own warning");

  $("#esSource").value = "g7";
  QD.onEsControlChange("esSource"); await flush();
  assert.ok(!$("#esDuringBox").className.includes("hidden"), "during controls appear for a range source");
  const g = await QD.runEventStudy(); await flush();
  assert.strictEqual(g.kind, "range");
  assert.ok(!$("#esNWarn").className.includes("hidden") && $("#esNWarn").textContent.includes("2 ครั้ง"), "a 2-event group raises the n < 10 warning");
  assert.ok($("#esDurInfo").textContent.includes("ความยาวเหตุการณ์"), "the duration panel is rendered");
  console.log("[ok] UI: a range source shows the during + duration controls and the small-sample warning");

  // jsdom has no canvas: a stub Chart records what would have been drawn
  w.Chart = function (canvas, cfg) { this.canvas = canvas; this.data = cfg.data; this.options = cfg.options; this.destroy = () => {}; };
  const dsFor = (stat, baseline) => {
    QD.state.eventStudy.stat = stat; QD.state.eventStudy.showBaseline = baseline;
    return QD.renderEventStudyChart(QD.state.eventStudy.result, QD.esCurrentSource()).data.datasets.map((d) => d.label);
  };
  eq(dsFor("med", false), ["Median"], "median alone");
  eq(dsFor("mean", false), ["Mean"], "mean alone");
  eq(dsFor("p25p75", false), ["P25", "P75", "Median"], "band drawn under the line");
  eq(dsFor("minmax", true), ["Min", "Max", "Median", "ช่วงปกติ (อ้างอิง)"], "min-max band + the baseline reference");
  const chart = QD.state.eventStudy.chart;
  eq(chart.options.plugins.esBoundaries.marks.map((m) => m.label), ["เริ่ม", "จบ"], "boundary markers for a range source");
  assert.strictEqual(chart.data.labels.length, QD.state.eventStudy.result.labels.length, "one label per column");
  console.log("[ok] chart datasets follow the statistic picker and the baseline checkbox");

  console.log("\nALL EVENT STUDY TESTS PASSED");
}
main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
