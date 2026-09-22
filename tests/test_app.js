// Real-execution test harness for docs/index.html using jsdom.
// Mocks the Supabase client (auth + from() query builder + rpc()) so the
// actual application code (DOM rendering, event wiring, calculation
// pipeline) runs for real against a simulated backend -- not just a
// read-through of the source.

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, process.env.QD_HTML || "../index.html"), "utf8");

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://localhost/",
  beforeParse(window) {
    window.__QD_TEST__ = true; // prevent auto QD.init() so the test controls init timing
  }
});
const { window } = dom;

function flush(times = 3) {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) p = p.then(() => new Promise((r) => setImmediate(r)));
  return p;
}

// ---------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------
const MOCK_INSTRUMENTS = [
  { id: 1, ticker: "SPY", name: "SPDR S&P 500 ETF", category: "broad_market" },
  { id: 2, ticker: "QQQ", name: "Invesco QQQ Trust", category: "broad_market" }
];
const MOCK_RANGES = {
  1: { min: "2010-01-05", max: "2024-12-05" }, // -> lookback 10 => end years 2019..2024 (6 points)
  2: { min: "2012-03-01", max: "2024-12-05" }
};

function makeQueryBuilder(table) {
  const q = { table, filters: {}, orders: [], limitN: null };
  const builder = {
    select() { return builder; },
    eq(col, val) { q.filters[col] = val; return builder; },
    order(col, opts) { q.orders.push({ col, ascending: !opts || opts.ascending !== false }); return builder; },
    limit(n) { q.limitN = n; return builder; },
    then(onFulfilled, onRejected) {
      return Promise.resolve().then(() => resolve()).then(onFulfilled, onRejected);
    }
  };
  function resolve() {
    if (table === "instruments") {
      return { data: MOCK_INSTRUMENTS, error: null };
    }
    if (table === "ohlcv_daily") {
      const id = q.filters.instrument_id;
      const range = MOCK_RANGES[id];
      if (!range) return { data: [], error: null };
      const asc = q.orders.length ? q.orders[0].ascending : true;
      return { data: [{ date: asc ? range.min : range.max }], error: null };
    }
    if (table === "macro_series") {
      const seriesId = q.filters.series_id;
      if (q.limitN === 1) {
        const latest = MOCK_MACRO_LATEST[seriesId];
        return { data: latest ? [{ date: latest.date, value: latest.value }] : [], error: null };
      }
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }
  return builder;
}

const rpcCallLog = [];

// 7 monthly period-end closes (P0..P6) feeding the Leaderboard/Rotation Graph
// DOM integration tests below -- trailing-return ranking (lookback=2) is
// EFA > EEM > SPY, hand-verified from these series.
// id 1 = SPY (reused as benchmark), id 10 = EFA, id 11 = EEM (reused tickers
// so getUniverseInstruments' Asset-Class-mode filter has real matches once
// pushed into QD.state.instruments later in the test run).
const MOCK_MOMENTUM_PRICES = {
  1:  [100, 101, 100, 102, 104, 103, 106],
  10: [100, 105, 130, 120, 140, 135, 150],
  11: [100,  98, 101,  97, 103, 110, 108]
};
function mockMomentumSeriesFor(id) {
  const prices = MOCK_MOMENTUM_PRICES[id];
  if (!prices) return null;
  return prices.map((p, i) => ({ instrument_id: id, period_end: `P${i}`, adj_close: p }));
}

const MOCK_MACRO_LATEST = {
  FEDFUNDS: { date: "2026-08-01", value: 4.33 },
  DGS10: { date: "2026-08-01", value: 4.10 }
};

// ---------------------------------------------------------------------
// Volume mocks (2026-09 Volume Anomaly feature)
// ---------------------------------------------------------------------
// 16 periods per instrument. With baseline = 12, the baseline window for
// the last point is indices 3..14, which is the SAME 12-value pattern for
// every instrument below:
//   [1005,995,1015,985,1000,1020,980,1000,1010,990,1005,995]
//   mean = 1000 exactly, sample variance = 1550/11, sd = sqrt(1550/11)
// Only the final (current) value differs, so the expected Z-score / RVOL of
// each instrument is hand-derivable without re-running the implementation.
const VOL_PATTERN = [1000, 1010, 990, 1005, 995, 1015, 985, 1000, 1020, 980, 1000, 1010, 990, 1005, 995];
const MOCK_VOLUME_CURRENT = { 1: 1002, 10: 3000, 11: 100 };

function mockVolumeSeriesFor(id) {
  const current = MOCK_VOLUME_CURRENT[id];
  if (current === undefined) return null;
  const vols = VOL_PATTERN.concat([current]);
  return vols.map((v, i) => ({
    instrument_id: id,
    period_end: `V${String(i).padStart(2, "0")}`,
    volume: v,
    adj_close: 100 + i
  }));
}

const periodVolumeCallLog = []; // one entry per underlying page-request

// Expected values for the mock volume series, re-derived here in LOG space
// with explicit formulas (deliberately not by calling the implementation):
// with baseline = 12 the window for the final point is VOL_PATTERN[3..14].
const VOL_BASELINE_WINDOW = VOL_PATTERN.slice(3, 15);
const VOL_LOGS = VOL_BASELINE_WINDOW.map(Math.log);
const VOL_MEAN_LOG = VOL_LOGS.reduce((a, b) => a + b, 0) / VOL_LOGS.length;
const VOL_SD_LOG = Math.sqrt(VOL_LOGS.reduce((a, b) => a + (b - VOL_MEAN_LOG) * (b - VOL_MEAN_LOG), 0) / (VOL_LOGS.length - 1));
const VOL_GEO_MEAN = Math.exp(VOL_MEAN_LOG);
const EXPECTED_LOG_Z = (current) => (Math.log(current) - VOL_MEAN_LOG) / VOL_SD_LOG;

// Synthetic large per-instrument series, used only by the pagination test
// below -- proves fetchPeriodEndCloses() correctly loops across multiple
// .range() pages and reassembles the full result without loss/duplication
// at the page boundary (the exact real-world bug: PostgREST's default
// "Max Rows" setting was silently truncating period_end_closes() responses
// at 1000 rows, dropping whole instruments -- confirmed against the live
// production Supabase project, see decision log).
const MOCK_BIG_SERIES = {};
function makeBigMockSeries(id, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ instrument_id: id, period_end: `PG${String(i).padStart(5, "0")}`, adj_close: 100 + i * 0.01 });
  }
  return rows;
}
MOCK_BIG_SERIES.BIG1 = makeBigMockSeries("BIG1", 5000); // > 1 page at PAGE_SIZE=4000
MOCK_BIG_SERIES.BIG2 = makeBigMockSeries("BIG2", 1);    // lands entirely on page 2

function mockSeriesForRpc(id) {
  return MOCK_BIG_SERIES[id] || mockMomentumSeriesFor(id);
}

const periodEndClosesCallLog = []; // one entry per underlying HTTP page-request (per .range() call)

// 2026-09-15: data_as_of() + every period RPC must ask for complete periods only
const MOCK_DATA_AS_OF = {
  as_of: "2026-09-14", week_cutoff: "2026-09-14", month_cutoff: "2026-09-01",
  last_complete_week_start: "2026-09-07", last_complete_month_start: "2026-08-01"
};
const dataAsOfCallLog = [];

// 2026-09-21: market events + Data Health mocks
const MOCK_EVENTS = [
  { event_type: "fomc", event_date: "2026-07-29", market_date: "2026-07-29", is_future: false, name_th: "ประชุม FOMC (Fed)", name_en: "FOMC decision", category: "monetary", show_default: true, note: null },
  { event_type: "cpi", event_date: "2026-08-12", market_date: "2026-08-12", is_future: false, name_th: "ประกาศ CPI สหรัฐ", name_en: "US CPI release", category: "inflation", show_default: false, note: null },
  { event_type: "fomc", event_date: "2026-09-16", market_date: "2026-09-16", is_future: false, name_th: "ประชุม FOMC (Fed)", name_en: "FOMC decision", category: "monetary", show_default: true, note: null },
  { event_type: "us_election_mid", event_date: "2026-11-03", market_date: "2026-11-03", is_future: true, name_th: "เลือกตั้งกลางเทอมสหรัฐ", name_en: "US midterm election", category: "politics", show_default: true, note: null }
];
const MOCK_HEALTH = {
  as_of: "2026-09-18", last_fetch_run: "2026-09-20T23:43:05Z",
  instruments: [
    { id: 1, ticker: "SPY", name: "SPDR S&P 500", category: "broad_market", first_date: "1993-01-29", last_date: "2026-09-18", rows: 8467, days_behind: 0, missing_1y: 0, last_run_at: "2026-09-20T23:40:54Z", last_status: "ok", last_message: "7 row(s) upserted", error_streak: 0 },
    { id: 2, ticker: "BADX", name: "Broken <b>ETF</b>", category: "thematic", first_date: "2019-01-02", last_date: "2026-09-10", rows: 1900, days_behind: 6, missing_1y: 0, last_run_at: "2026-09-20T23:41:00Z", last_status: "error", last_message: "<script>window.__pwned=1</script>", error_streak: 4 },
    { id: 3, ticker: "GAPY", name: "Gappy ETF", category: "thematic", first_date: "2019-01-02", last_date: "2026-09-18", rows: 1800, days_behind: 0, missing_1y: 2, last_run_at: "2026-09-20T23:41:10Z", last_status: "ok", last_message: "ok", error_streak: 0 },
    { id: 4, ticker: "AAAA", name: "Fine ETF", category: "thematic", first_date: "2019-01-02", last_date: "2026-09-18", rows: 1850, days_behind: 0, missing_1y: 0, last_run_at: "2026-09-20T23:41:20Z", last_status: "ok", last_message: "ok", error_streak: 0 }
  ],
  macro: [
    { series_id: "CPIAUCSL", first_date: "1990-01-01", last_date: "2026-07-01", rows: 438, last_loaded_at: "2026-09-08T15:22:47Z" },
    { series_id: "DGS10", first_date: "1990-01-02", last_date: "2026-09-17", rows: 9184, last_loaded_at: "2026-09-18T23:42:09Z" }
  ],
  events: [
    { code: "fomc", name_th: "ประชุม FOMC (Fed)", source: "curated", count: 271, first_date: "1994-02-04", last_past: "2026-09-16", next_date: "2026-10-28", updated_at: "2026-09-21T15:59:20Z" },
    { code: "cpi", name_th: "ประกาศ CPI สหรัฐ", source: "fred", count: 0, first_date: null, last_past: null, next_date: null, updated_at: null }
  ]
};
const marketEventsCallLog = [];
const dataHealthCallLog = [];
const mockFailures = { events: false, health: false };

async function resolveRpcCall(name, params, range) {
  if (name === "market_events_between") {
    marketEventsCallLog.push({ params, range });
    if (mockFailures.events) return { data: null, error: { message: "permission denied" } };
    let rows = MOCK_EVENTS.slice();
    if (range) rows = rows.slice(range.from, range.to + 1);
    return { data: rows, error: null };
  }
  if (name === "data_health_overview") {
    dataHealthCallLog.push(params);
    if (mockFailures.health) return { data: null, error: { message: "timeout" } };
    return { data: JSON.parse(JSON.stringify(MOCK_HEALTH)), error: null };
  }
  if (name === "data_as_of") {
    dataAsOfCallLog.push(params);
    return { data: MOCK_DATA_AS_OF, error: null };
  }
  if (name === "seasonal_stats") {
    rpcCallLog.push(params);
    const stats = {
      n: params.p_lookback_years || 15,
      mean_pct: 1.23, median_pct: 1.1, geometric_mean_pct: 1.0, win_frequency_pct: 55,
      average_win_pct: 2.5, best_observation_pct: 6.0, above_mean_frequency_pct: 50, tail_win_frequency_pct: 5,
      loss_frequency_pct: 45, average_loss_pct: -2.1, worst_observation_pct: -5.5, below_mean_frequency_pct: 50, tail_loss_frequency_pct: 0,
      standard_deviation_pct: 3.3, downside_deviation_pct: 2.2, cvar_5pct_pct: -6.6, cvar_5pct_n: 1,
      risk_adjusted_return_x: 0.37, downside_adjusted_return_x: 0.56, payoff_ratio_x: 1.19, gain_to_pain_ratio_x: 1.02
    };
    return { data: stats, error: null };
  }
  if (name === "period_end_closes") {
    periodEndClosesCallLog.push({ params, range });
    const ids = params.p_instrument_ids || [];
    let rows = [];
    ids.forEach((id) => {
      const series = mockSeriesForRpc(id);
      if (series) rows.push(...series);
    });
    // Simulate PostgREST's Range-header pagination: .range(from, to) is
    // inclusive of `to`, exactly like the real API.
    if (range) rows = rows.slice(range.from, range.to + 1);
    return { data: rows, error: null };
  }
  if (name === "period_volume_series") {
    periodVolumeCallLog.push({ params, range });
    const ids = params.p_instrument_ids || [];
    let rows = [];
    ids.forEach((id) => {
      const series = mockVolumeSeriesFor(id);
      if (series) rows.push(...series);
    });
    if (range) rows = rows.slice(range.from, range.to + 1);
    return { data: rows, error: null };
  }
  throw new Error("mockRpc: unexpected rpc name " + name);
}

// sb.rpc(...) must return a chainable, thenable builder (not a bare Promise)
// so that real app code can do `sb.rpc(name, params).range(from, to)` --
// mirrors the real supabase-js PostgrestFilterBuilder, and the existing
// makeQueryBuilder() pattern already used for sb.from(...) below.
function mockRpc(name, params) {
  let range = null;
  const builder = {
    range(from, to) { range = { from, to }; return builder; },
    then(onFulfilled, onRejected) {
      return resolveRpcCall(name, params, range).then(onFulfilled, onRejected);
    }
  };
  return builder;
}

let authCallback = null;
let currentSession = null;
const mockClient = {
  auth: {
    async getSession() { return { data: { session: currentSession } }; },
    onAuthStateChange(cb) { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email, password }) {
      if (password === "wrong") return { data: { session: null }, error: { message: "Invalid login credentials" } };
      currentSession = { user: { email }, access_token: "fake-token" };
      if (authCallback) authCallback("SIGNED_IN", currentSession);
      return { data: { session: currentSession }, error: null };
    },
    async signOut() {
      currentSession = null;
      if (authCallback) authCallback("SIGNED_OUT", null);
      return { error: null };
    }
  },
  from(table) { return makeQueryBuilder(table); },
  rpc: mockRpc
};

// ---------------------------------------------------------------------
// Test run
// ---------------------------------------------------------------------
async function main() {
  const QD = window.QD;
  assert.ok(QD, "window.QD namespace must exist");

  // ---- pure helpers ----
  assert.strictEqual(QD.periodLabel("month", 1), "มกราคม");
  assert.strictEqual(QD.periodLabel("week", 5), "สัปดาห์ที่ 5");
  assert.strictEqual(QD.lookbackLabel(10), "10 ปี");
  assert.strictEqual(QD.lookbackLabel(null), "ทั้งหมด");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.computeEndYearRange(2010, 2024, 10))), [2019, 2020, 2021, 2022, 2023, 2024]);
  assert.strictEqual(QD.computeEndYearRange(2010, 2024, null), null, "lookback=all has no sliding window");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.computeEndYearRange(2020, 2024, 10))), [], "not enough history yet for a full window");
  assert.strictEqual(QD.formatVal({ key: "mean_pct", kind: "pct" }, { mean_pct: 1.2345 }), "1.23%");
  assert.strictEqual(QD.formatVal({ key: "payoff_ratio_x", kind: "x" }, { payoff_ratio_x: 1.5 }), "1.50x");
  assert.strictEqual(
    QD.formatVal({ key: "cvar_5pct_pct", kind: "pct", countKey: "cvar_5pct_n" }, { cvar_5pct_pct: -6.6, cvar_5pct_n: 3 }),
    "-6.60% (n=3)"
  );
  console.log("[ok] pure helper functions");

  // ---- init while logged out ----
  await QD.init(mockClient);
  assert.strictEqual(window.document.getElementById("authScreen").classList.contains("hidden"), false, "auth screen visible when logged out");
  assert.strictEqual(window.document.getElementById("dashboardScreen").classList.contains("hidden"), true, "dashboard hidden when logged out");
  console.log("[ok] initial render shows login screen");

  // ---- stat glossary (static content, rendered regardless of login state) ----
  const glossaryEl = window.document.getElementById("statGlossary");
  assert.ok(glossaryEl, "#statGlossary container should exist");
  const glossaryText = glossaryEl.textContent;
  QD.STAT_FIELDS.forEach((f) => {
    assert.ok(glossaryText.includes(f.label), `glossary should mention "${f.label}"`);
    assert.ok(f.desc && f.desc.length > 0, `STAT_FIELDS entry "${f.key}" should have a non-empty desc`);
    assert.ok(glossaryText.includes(f.desc), `glossary should include the description for "${f.label}"`);
  });
  assert.ok(glossaryText.includes("CVaR (5%) n"), "glossary should explain the CVaR sample-count column");
  assert.ok(glossaryEl.querySelectorAll("h3").length >= 4, "glossary should be grouped under group headers");
  console.log("[ok] stat glossary rendered with all 20 metric descriptions");

  // ---- failed login ----
  const badLogin = await QD.login("user@test.com", "wrong");
  assert.strictEqual(badLogin, false);
  assert.strictEqual(window.document.getElementById("loginError").classList.contains("hidden"), false);
  console.log("[ok] failed login shows error, does not open dashboard");

  // ---- successful login ----
  const okLogin = await QD.login("user@test.com", "correct-password");
  assert.strictEqual(okLogin, true);
  await flush();
  assert.strictEqual(window.document.getElementById("dashboardScreen").classList.contains("hidden"), false, "dashboard visible after login");
  console.log("[ok] successful login opens dashboard, triggers bootDashboard via onAuthStateChange");

  // ---- instruments loaded, default asset = SPY ----
  assert.strictEqual(QD.state.instruments.length, 2);
  assert.strictEqual(QD.state.assetId, 1, "should default to SPY (id=1)");
  assert.ok(window.document.getElementById("assetPicker").innerHTML.includes("SPY"));
  console.log("[ok] instruments loaded + asset picker defaults to SPY");

  // ---- overview table: 12 month rows, auto-run on load ----
  const overviewRowsEl = window.document.querySelectorAll("#overviewTable tbody tr");
  assert.strictEqual(overviewRowsEl.length, 12, "overview table should auto-render 12 month rows");
  assert.strictEqual(QD.state.overviewRows.length, 12);
  assert.strictEqual(QD.state.overviewRows[5].stats.mean_pct, 1.23);
  console.log("[ok] Level 1 overview table auto-runs and renders 12 rows x 20 metrics");

  // ---- clicking a row autofills Period Controls variant 1 ----
  const juneRow = Array.from(overviewRowsEl).find((tr) => tr.getAttribute("data-period") === "6");
  assert.ok(juneRow, "June row (period=6) should exist");
  juneRow.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.strictEqual(QD.state.variants[0].period, 6);
  assert.strictEqual(QD.state.variants[0].enabled, true);
  assert.strictEqual(QD.state.variants[0].assetId, 1);
  assert.strictEqual(QD.state.variants[0].lookback, 10);
  console.log("[ok] clicking an overview row auto-fills Period Controls variant 1 (F8)");

  // ---- enable variant 2 with lookback = "all" (edge case: no rolling window) ----
  QD.state.variants[1] = { enabled: true, assetId: 2, periodType: "month", period: 3, lookback: null };
  QD.renderVariantForms();
  console.log("[ok] variant 2 configured with lookback=all (edge case for Rolling Chart)");

  // ---- run calculate ----
  rpcCallLog.length = 0;
  await QD.runCalculate();
  await flush();

  // variant 1: SPY range 2010-2024, lookback 10 -> 6 end years -> 6 rolling calls + 1 snapshot = 7
  assert.ok(QD.state.results[0].rollingSeries, "variant 1 should have a rolling series");
  assert.strictEqual(QD.state.results[0].rollingSeries.length, 6);
  assert.ok(QD.state.results[0].snapshot);

  // variant 2: lookback=all -> no rolling series, but snapshot still computed (for Compare table)
  assert.strictEqual(QD.state.results[1].rollingSeries, null);
  assert.ok(QD.state.results[1].snapshot);

  // variant 3: not enabled -> untouched
  assert.strictEqual(QD.state.results[2], null);

  // total RPC calls: 6 (v1 rolling) + 1 (v1 snapshot) + 1 (v2 snapshot, no rolling) = 8
  assert.strictEqual(rpcCallLog.length, 8, `expected 8 rpc calls, got ${rpcCallLog.length}`);
  console.log("[ok] Calculate button runs correct RPC sequence per variant (rolling window via p_end_year + snapshot)");

  // ---- Rolling Chart: dataset construction + "all" variant correctly omitted ----
  QD.renderChart("mean_pct");
  const note = window.document.getElementById("chartEmptyNote").textContent;
  assert.ok(note.includes("ทั้งหมด"), "chart should note that the all-history variant is excluded");
  console.log("[ok] Rolling Chart omits lookback=all variant with an explanatory note");

  // ---- Compare table: both enabled variants (with snapshots) appear as columns ----
  const compareHead = window.document.querySelectorAll("#compareTable thead th");
  assert.strictEqual(compareHead.length, 3, "Metric column + 2 variant columns");
  const compareBody = window.document.querySelectorAll("#compareTable tbody tr");
  assert.strictEqual(compareBody.length, 21, "n row + 20 metric rows");
  console.log("[ok] Compare table renders all 20 metrics x enabled variants (incl. the lookback=all one)");

  // ---- Export to Excel: checkbox availability + data shaping ----
  // runCalculate() above already populated state.results (variant 1 has a rolling
  // series + snapshot, variant 2 has a snapshot only) and should have enabled the
  // previously-disabled Rolling/Compare export checkboxes via updateExportAvailability().
  const exportRollingCb = window.document.getElementById("exportRolling");
  const exportCompareCb = window.document.getElementById("exportCompare");
  assert.strictEqual(exportRollingCb.disabled, false, "Rolling export checkbox should unlock once a rolling series exists");
  assert.strictEqual(exportCompareCb.disabled, false, "Compare export checkbox should unlock once a snapshot exists");
  console.log("[ok] Export checkboxes unlock automatically once Calculate has produced data");

  // header labels carry the unit so raw numbers in Excel are self-explanatory
  const meanFieldForHeader = QD.STAT_FIELDS.find((f) => f.key === "mean_pct");
  const payoffFieldForHeader = QD.STAT_FIELDS.find((f) => f.key === "payoff_ratio_x");
  assert.strictEqual(QD.fieldHeaderLabel(meanFieldForHeader), "Mean (%)");
  assert.strictEqual(QD.fieldHeaderLabel(payoffFieldForHeader), "Payoff Ratio (x)");

  // buildExportColumns must place the CVaR sample-count column right after CVaR itself
  const exportColumns = QD.buildExportColumns();
  const cvarIdx = exportColumns.findIndex((c) => c.header === "CVaR (5%) (%)");
  assert.ok(cvarIdx >= 0, "CVaR column should exist");
  assert.strictEqual(exportColumns[cvarIdx + 1].header, "CVaR (5%) n", "CVaR sample count column should follow immediately");
  console.log("[ok] buildExportColumns: all 20 metrics + CVaR n placed correctly, unit-labeled headers");

  // Overview sheet: header + 12 month rows, raw numeric values (not "1.23%" strings)
  exportRollingCb.checked = true;
  exportCompareCb.checked = true;
  const allSheets = QD.buildExportSheets({ overview: true, rolling: true, compare: true });
  assert.strictEqual(allSheets.overview.length, 13, "header row + 12 month rows");
  assert.strictEqual(allSheets.overview[0][0], "Period");
  assert.strictEqual(allSheets.overview[1][0], "มกราคม");
  const meanColIdxInSheet = allSheets.overview[0].indexOf("Mean (%)");
  assert.strictEqual(allSheets.overview[1][meanColIdxInSheet], 1.23, "raw numeric value, not a formatted '1.23%' string");

  // Rolling sheet: one row per (variant x end-year) point -- variant 1 alone has 6 end-years
  assert.strictEqual(allSheets.rolling[0][0], "Variant");
  assert.strictEqual(allSheets.rolling.length - 1, 6, "only variant 1 has a rolling series (6 end-years); variant 2 (lookback=all) contributes none");

  // Compare sheet: one row per enabled variant with a snapshot (both variant 1 and 2)
  assert.strictEqual(allSheets.compare.length - 1, 2, "one row per variant with a snapshot");
  console.log("[ok] buildExportSheets: Overview/Rolling/Compare shaped correctly with raw numeric values");

  // Selecting nothing is a validation error, not a silent no-op
  window.document.getElementById("exportOverview").checked = false;
  exportRollingCb.checked = false;
  exportCompareCb.checked = false;
  const emptyResult = QD.exportToExcel();
  assert.strictEqual(emptyResult, null, "exportToExcel should refuse when nothing is selected");
  assert.strictEqual(window.document.getElementById("exportError").classList.contains("hidden"), false);
  window.document.getElementById("exportOverview").checked = true; // restore default for any later assertions
  console.log("[ok] exportToExcel refuses with an inline error when no section is selected");

  // exportToExcel must not throw even though this jsdom env has no XLSX library loaded --
  // it should still build and return the sheet data (verified above via buildExportSheets directly).
  window.document.getElementById("exportOverview").checked = true;
  const resultWithoutXlsx = QD.exportToExcel();
  assert.ok(resultWithoutXlsx.overview, "falls back to returning sheet data when XLSX global is unavailable");
  console.log("[ok] exportToExcel runs without throwing when the XLSX library is unavailable");

  // ---- heatmap: direction-aware relative coloring ----
  const rangeHigh = { min: 0, max: 10 };
  assert.strictEqual(QD.heatmapColor(10, rangeHigh, "high"), "hsl(120, 65%, 85%)", "high value + high-is-better = green");
  assert.strictEqual(QD.heatmapColor(0, rangeHigh, "high"), "hsl(0, 65%, 85%)", "low value + high-is-better = red");
  assert.strictEqual(QD.heatmapColor(0, rangeHigh, "low"), "hsl(120, 65%, 85%)", "low value + low-is-better = green (flipped)");
  assert.strictEqual(QD.heatmapColor(10, rangeHigh, "low"), "hsl(0, 65%, 85%)", "high value + low-is-better = red (flipped)");
  assert.strictEqual(QD.heatmapColor(5, rangeHigh, "high"), "hsl(60, 65%, 85%)", "midpoint = yellow");
  assert.strictEqual(QD.heatmapColor(null, rangeHigh, "high"), null, "null value gets no color");
  assert.strictEqual(QD.heatmapColor(5, { min: 5, max: 5 }, "high"), "hsl(50, 20%, 92%)", "no spread in column -> neutral color, not an error");

  const rows12 = Array.from({ length: 12 }, (_, i) => ({ period: i + 1, stats: { mean_pct: i } })); // 0..11
  const meanField = QD.STAT_FIELDS.find((f) => f.key === "mean_pct");
  const range = QD.computeColumnRange(meanField, rows12);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(range)), { min: 0, max: 11 });
  console.log("[ok] heatmap: computeColumnRange + direction-aware heatmapColor");

  // ---- overview table cells actually carry the computed heatmap color inline ----
  // (state.overviewRows from the earlier auto-run fetch, still populated with mock RPC data)
  const overviewCells = window.document.querySelectorAll("#overviewTable tbody tr:first-child td");
  const meanColIdx = 2; // Period, n, then STAT_FIELDS in order -- mean_pct is index 0 of STAT_FIELDS
  assert.ok(overviewCells[meanColIdx].getAttribute("style"), "stat cell should carry an inline heatmap background color");
  console.log("[ok] overview table renders heatmap background-color on stat cells");

  // ---- overview chart: pure dataset builder ----
  const chartData = QD.buildOverviewChartDatasets(
    [
      { period: 1, stats: { worst_observation_pct: -5, best_observation_pct: 8, mean_pct: 1.2, win_frequency_pct: 60 } },
      { period: 2, stats: null }
    ],
    "month"
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(chartData.labels)), ["มกราคม", "กุมภาพันธ์"]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(chartData.range)), [[-5, 8], [null, null]]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(chartData.mean)), [1.2, null]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(chartData.winRate)), [60, null]);
  console.log("[ok] overview chart: buildOverviewChartDatasets shapes Worst-Best range + Mean + Win Rate correctly");

  // renderOverviewChart must not throw even with Chart.js absent (this jsdom env has no canvas/Chart.js) --
  // it should build the datasets and bail out cleanly before touching the canvas context.
  QD.renderOverviewChart();
  console.log("[ok] renderOverviewChart runs without throwing when Chart.js is unavailable");

  // =====================================================================
  // Momentum & Rotation tab (Phase 2)
  // =====================================================================

  // ---- pure math: hand-computable small cases ----
  const s3 = ["D0", "D1", "D2"].map((d, i) => ({ period_end: d, adj_close: [100, 110, 121][i] }));
  assert.ok(Math.abs(QD.computeTrailingReturn(s3, 2) - 21) < 1e-9, "trailing return over 2 periods: 121/100-1 = 21%");
  assert.strictEqual(QD.computeTrailingReturn(s3, 5), null, "insufficient history -> null, not an error");

  const s3b = ["D0", "D1", "D2"].map((d, i) => ({ period_end: d, adj_close: [100, 105, 110][i] }));
  const smaSig1 = QD.computeSMASignal(s3b, 3);
  assert.strictEqual(smaSig1.sma, 105);
  assert.strictEqual(smaSig1.pass, true, "110 > SMA(105)");
  assert.strictEqual(QD.computeSMASignal(s3b, 5), null, "insufficient history -> null");

  const rets2 = QD.computeReturnSeries(["D0", "D1", "D2"].map((d, i) => ({ period_end: d, adj_close: [100, 110, 99][i] })));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rets2.map((r) => Number(r.toFixed(4))))), [0.1, -0.1]);
  assert.ok(Math.abs(QD.stdevSample(rets2) - Math.sqrt(0.02)) < 1e-9, "sample stdev of [0.1,-0.1] = sqrt(0.02)");
  assert.strictEqual(QD.stdevSample([1]), null, "need >= 2 observations");

  // ema()/sma(): manual hand trace, alpha = 2/(3+1) = 0.5, seeded with SMA(3)
  const emaVals1 = QD.ema([1, 2, 3, 4, 5], 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(emaVals1)), [null, null, 2, 3, 4]);
  const smaVals1 = QD.sma([1, 2, 3, 4, 5], 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(smaVals1)), [null, null, 2, 3, 4]);
  console.log("[ok] Momentum: trailing return / SMA trend filter / stdev / weighting / ema+sma (hand-computed)");

  // classifyOctant: angle 0/45/90/180/270 degrees around the (100,100) origin
  assert.strictEqual(QD.classifyOctant(110, 100), "Leading – Accelerating"); // 0deg
  assert.strictEqual(QD.classifyOctant(100 + 10 / Math.SQRT2, 100 + 10 / Math.SQRT2), "Leading – Strong"); // 45deg
  assert.strictEqual(QD.classifyOctant(100, 110), "Improving – Strong"); // 90deg
  assert.strictEqual(QD.classifyOctant(90, 100), "Lagging – Weak"); // 180deg
  assert.strictEqual(QD.classifyOctant(100, 90), "Weakening – Strong"); // 270deg
  assert.strictEqual(QD.classifyOctant(null, 100), null);
  console.log("[ok] classifyOctant: 8-way angle labels match hand-derived quadrant/octant boundaries");

  // rankUniverseFromSeries: filtering (insufficient history excluded, not nulled)
  // + risk-adjusted sort sinks a null score (zero-volatility edge case) to the bottom
  const flatSeries = ["D0", "D1", "D2", "D3"].map((d) => ({ period_end: d, adj_close: 100 })); // zero volatility
  const upSeries = ["D0", "D1", "D2", "D3"].map((d, i) => ({ period_end: d, adj_close: [100, 105, 110, 115][i] }));
  const shortSeries = ["D0", "D1"].map((d, i) => ({ period_end: d, adj_close: [100, 101][i] }));
  const rankItems = [
    { instrumentId: "flat", ticker: "FLAT", name: "Flat", category: "test", series: flatSeries },
    { instrumentId: "up", ticker: "UP", name: "Up", category: "test", series: upSeries },
    { instrumentId: "short", ticker: "SHORT", name: "Short", category: "test", series: shortSeries }
  ];
  const rankedPlain = QD.rankUniverseFromSeries(rankItems, { lookbackPeriods: 3, smaPeriods: 3, riskAdjusted: false, riskFreeAnnualPct: 0, periodsPerYear: 12 });
  assert.strictEqual(rankedPlain.length, 2, "the too-short series is excluded entirely, not shown with a null return");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rankedPlain.map((r) => r.ticker))), ["UP", "FLAT"], "higher trailing return ranks first");
  const rankedRiskAdj = QD.rankUniverseFromSeries(rankItems, { lookbackPeriods: 3, smaPeriods: 3, riskAdjusted: true, riskFreeAnnualPct: 0, periodsPerYear: 12 });
  assert.strictEqual(rankedRiskAdj[0].ticker, "UP");
  assert.strictEqual(rankedRiskAdj[1].ticker, "FLAT", "zero volatility -> null risk-adjusted score -> sinks to the bottom, but still listed");
  assert.strictEqual(rankedRiskAdj[1].riskAdjScore, null);
  console.log("[ok] rankUniverseFromSeries: excludes insufficient history, sorts by return or risk-adjusted score correctly");

  // ---- cross-check core primitives against independent Python/numpy/pandas ground truth ----
  // (same rigor as the period_end_closes RPC validation: synthetic data,
  // ground truth computed independently in a different language/library,
  // exact-match comparison -- see /tmp/qd_mom_validate/gen.py)
  const gtPath = "/tmp/qd_mom_validate/ground_truth.json";
  if (fs.existsSync(gtPath)) {
    const gt = JSON.parse(fs.readFileSync(gtPath, "utf8"));
    const gtSeries = gt.prices.map((p, i) => ({ period_end: `D${i}`, adj_close: p }));
    assert.ok(Math.abs(QD.computeTrailingReturn(gtSeries, 12) - gt.trailing_return_pct) < 1e-6, "trailing return vs numpy ground truth");
    const gtSma = QD.computeSMASignal(gtSeries, 10);
    assert.ok(Math.abs(gtSma.sma - gt.sma_val) < 1e-6, "SMA vs pandas rolling mean ground truth");
    assert.strictEqual(gtSma.pass, gt.sma_pass);
    const gtPeriodicVol = QD.computePeriodicVolatility(gtSeries, 12);
    assert.ok(Math.abs(gtPeriodicVol - gt.periodic_vol_pct) < 1e-6, "periodic volatility vs numpy std(ddof=1) ground truth");
    assert.ok(Math.abs(QD.computeWindowVolatility(gtSeries, 12) - gt.window_vol_pct) < 1e-6);
    assert.ok(Math.abs(QD.computeRiskAdjustedScore(gt.trailing_return_pct, gt.window_vol_pct, 3.0, 12, 12) - gt.risk_adj_score) < 1e-6);

    const emaValsGt = QD.ema(gt.prices, 12);
    gt.ema_vals.forEach((v, i) => (v === null ? assert.strictEqual(emaValsGt[i], null) : assert.ok(Math.abs(emaValsGt[i] - v) < 1e-5, `ema mismatch at ${i}`)));
    const rollMeanGt = QD.sma(emaValsGt, 12);
    gt.roll_mean_vals.forEach((v, i) => (v === null ? assert.strictEqual(rollMeanGt[i], null) : assert.ok(Math.abs(rollMeanGt[i] - v) < 1e-5, `rolling mean mismatch at ${i}`)));
    console.log("[ok] core Momentum math (trailing return / SMA / stdev / EMA / rolling mean) cross-checked against independent Python/numpy/pandas ground truth");
  } else {
    console.log("[skip] Python ground-truth file not found -- cross-check skipped (see /tmp/qd_mom_validate/gen.py)");
  }

  // ---- tickerShortName (item 2): curated short names, fallback to bare ticker ----
  assert.strictEqual(QD.tickerShortName("SPY"), "S&P 500");
  assert.strictEqual(QD.tickerShortName("GLD"), "Gold");
  assert.strictEqual(QD.tickerShortName("__NOT_MAPPED__"), "__NOT_MAPPED__", "unmapped ticker falls back to itself");
  console.log("[ok] tickerShortName resolves curated short names with a bare-ticker fallback");

  // ---- getUniverseInstruments (10.2): push additional instruments the way a
  // real loadInstruments() call would, then verify each of the 3 universe modes ----
  QD.state.instruments.push(
    { id: 10, ticker: "EFA", name: "iShares MSCI EAFE ETF", category: "broad_market" },
    { id: 11, ticker: "EEM", name: "iShares MSCI Emerging Markets ETF", category: "broad_market" },
    { id: 12, ticker: "IEF", name: "iShares 7-10 Year Treasury Bond ETF", category: "bond" },
    { id: 13, ticker: "VNQ", name: "Vanguard Real Estate ETF", category: "reit" },
    { id: 14, ticker: "DBC", name: "Invesco DB Commodity Index Fund", category: "commodity" },
    { id: 15, ticker: "ARKK", name: "ARK Innovation ETF", category: "thematic" },
    { id: 16, ticker: "XLK", name: "Technology Select Sector SPDR", category: "us_sector" },
    { id: 17, ticker: "XLE", name: "Energy Select Sector SPDR", category: "us_sector" }
  );
  const assetClassUniverse = QD.getUniverseInstruments("asset_class");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(assetClassUniverse.map((i) => i.ticker))), ["SPY", "EFA", "EEM", "IEF", "VNQ", "DBC"], "Faber-style Asset Class universe (10.2 mode 1)");
  const broadUniverse = QD.getUniverseInstruments("broad_market");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(broadUniverse.map((i) => i.ticker).sort())), ["EEM", "EFA", "IEF", "QQQ", "SPY", "VNQ"], "Broad Market = category + the new IEF/VNQ (10.2 mode 2)");
  const thematicUniverse = QD.getUniverseInstruments("thematic");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(thematicUniverse.map((i) => i.ticker))), ["ARKK"], "Thematic = category tag only (10.2 mode 3)");
  const sectorUniverse = QD.getUniverseInstruments("us_sector");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sectorUniverse.map((i) => i.ticker).sort())), ["XLE", "XLK"], "US Sector = category tag only (added 2026-09)");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.getUniverseInstruments("__nope__"))), [], "an unknown mode still yields an empty universe, not a throw");
  // backward compatibility: the 3 pre-existing modes must not have absorbed the sector names
  assert.ok(!broadUniverse.some((i) => i.category === "us_sector"), "us_sector must not leak into Broad Market");
  assert.ok(!thematicUniverse.some((i) => i.category === "us_sector"), "us_sector must not leak into Thematic");
  assert.ok(!assetClassUniverse.some((i) => i.category === "us_sector"), "us_sector must not leak into Asset Class");
  console.log("[ok] getUniverseInstruments: all 4 universe modes (Asset Class / Broad Market / Thematic / US Sector) resolve correctly");

  // ---- the Universe picker actually offers the new mode ----
  const universeOptions = Array.from(window.document.getElementById("momUniversePicker").options).map((o) => o.value);
  assert.deepStrictEqual(universeOptions, ["asset_class", "broad_market", "thematic", "us_sector"],
    "US Sector is selectable in the UI, appended after Thematic so existing option order is unchanged");
  assert.strictEqual(window.document.getElementById("momUniversePicker").value, "asset_class",
    "default universe unchanged by the addition");

  // ---- classifyQuadrant: strict sign split, matching the RRG background zones ----
  assert.strictEqual(QD.classifyQuadrant(105, 110), "Leading");
  assert.strictEqual(QD.classifyQuadrant(95, 110), "Improving");
  assert.strictEqual(QD.classifyQuadrant(95, 90), "Lagging");
  assert.strictEqual(QD.classifyQuadrant(105, 90), "Weakening");
  assert.strictEqual(QD.classifyQuadrant(100, 100), "Lagging", "exactly on the crosshair falls into Lagging (x>100 and y>100 are both strict)");
  assert.strictEqual(QD.classifyQuadrant(null, 110), null);
  assert.strictEqual(QD.classifyQuadrant(105, NaN), null);
  // the 8-way octant label is angle-based and deliberately straddles the axes,
  // so near the boundary the two classifications disagree BY DESIGN -- the
  // scatter follows the zone because that is what its color legend promises
  assert.strictEqual(QD.classifyQuadrant(101, 140), "Leading");
  assert.ok(QD.classifyOctant(101, 140).startsWith("Improving"),
    "documented divergence: angle-based octant says Improving where the zone says Leading");
  console.log("[ok] classifyQuadrant matches the RRG background zones (and its documented divergence from classifyOctant holds)");

  // ---- quadrantMapFromRotation: reads the LAST point of each tail ----
  const rotForQuadrant = { m: 12, k: 8, results: [
    { instrumentId: 101, ticker: "AAA", points: [{ x: 90, y: 90 }, { x: 105, y: 110 }] },  // ends Leading
    { instrumentId: 102, ticker: "BBB", points: [{ x: 105, y: 110 }, { x: 95, y: 90 }] },  // ends Lagging
    { instrumentId: 103, ticker: "CCC", points: [] }                                        // no data at all
  ] };
  const qMap = QD.quadrantMapFromRotation(rotForQuadrant);
  assert.strictEqual(qMap[101], "Leading", "quadrant comes from the newest point, not the oldest");
  assert.strictEqual(qMap[102], "Lagging");
  assert.strictEqual(qMap[103], undefined, "an empty tail yields no entry rather than a guessed quadrant");
  assert.deepStrictEqual(Object.keys(QD.quadrantMapFromRotation(null)), [], "no rotationData yet => empty map, no throw");
  assert.deepStrictEqual(Object.keys(QD.quadrantMapFromRotation({ results: null })), []);

  // ---- buildPriceVolumeScatterDatasets ----
  const pvRows = [
    { instrumentId: 101, ticker: "AAA", shortName: "Alpha",  trailingReturnPct: 12.5, volZScore: 2.4, rvol: 3.1, volRank: 1, momRank: 1 },
    { instrumentId: 102, ticker: "BBB", shortName: "Beta",   trailingReturnPct: -8.0, volZScore: -1.2, rvol: 0.6, volRank: 3, momRank: 4 },
    { instrumentId: 104, ticker: "DDD", shortName: "Delta",  trailingReturnPct: 3.0,  volZScore: 0.5, rvol: 1.1, volRank: 2, momRank: 2 }, // not in rotation -> unknown
    { instrumentId: 105, ticker: "EEE", shortName: "Echo",   trailingReturnPct: 5.0,  volZScore: null, rvol: null, volRank: null, momRank: 3 }, // volume missing
    { instrumentId: 106, ticker: "FFF", shortName: "Foxtrot", trailingReturnPct: null, volZScore: 1.9, rvol: 2.0, volRank: 4, momRank: null }  // price missing
  ];
  const pvSets = QD.buildPriceVolumeScatterDatasets(pvRows, qMap);
  const plottedTotal = pvSets.reduce((n, d) => n + d.data.length, 0);
  assert.strictEqual(plottedTotal, 3, "only rows with BOTH coordinates are plottable (5 rows in, 3 dots out)");
  const byQuadrant = {};
  pvSets.forEach((d) => { d.data.forEach((p) => { byQuadrant[p.ticker] = d; }); });
  assert.strictEqual(byQuadrant.AAA.backgroundColor, "#059669", "Leading dot uses the RRG Leading zone color");
  assert.strictEqual(byQuadrant.BBB.backgroundColor, "#dc2626", "Lagging dot uses the RRG Lagging zone color");
  assert.strictEqual(byQuadrant.DDD.backgroundColor, "#94a3b8", "an instrument with no rotation entry falls into the gray unknown group");
  assert.strictEqual(byQuadrant.DDD.quadrant, null);
  assert.ok(byQuadrant.AAA.label.startsWith("Leading ("), "legend labels carry the quadrant name and a count");
  assert.ok(pvSets.every((d) => d.data.length > 0), "empty quadrants produce no dataset, so the legend stays honest");
  const aaaPoint = byQuadrant.AAA.data.find((p) => p.ticker === "AAA");
  assert.strictEqual(aaaPoint.x, 12.5, "x = trailing return");
  assert.strictEqual(aaaPoint.y, 2.4, "y = volume z-score");
  // colors must not depend on the row ORDER the table happens to be sorted by
  const reversedSets = QD.buildPriceVolumeScatterDatasets(pvRows.slice().reverse(), qMap);
  const colorOf = (sets, ticker) => sets.find((d) => d.data.some((p) => p.ticker === ticker)).backgroundColor;
  ["AAA", "BBB", "DDD"].forEach((t) =>
    assert.strictEqual(colorOf(reversedSets, t), colorOf(pvSets, t), `${t} keeps its quadrant color regardless of table sort order`));
  // with no rotation data at all, everything is one gray group
  const allUnknown = QD.buildPriceVolumeScatterDatasets(pvRows, {});
  assert.strictEqual(allUnknown.length, 1);
  assert.strictEqual(allUnknown[0].backgroundColor, "#94a3b8");
  assert.strictEqual(QD.buildPriceVolumeScatterDatasets([], qMap).length, 0, "no rows => no datasets");
  assert.strictEqual(QD.buildPriceVolumeScatterDatasets(null, qMap).length, 0);
  console.log("[ok] Price-Volume scatter datasets: 4 quadrant colors + gray unknown, both-axes rule, order-independent");

  // ---- tooltip text ----
  const tip = QD.formatPvScatterTooltip(aaaPoint);
  assert.ok(tip[0].includes("AAA") && tip[0].includes("Alpha"));
  assert.ok(tip.some((l) => l.includes("+12.50%")), "return is signed and shown as a percent");
  assert.ok(tip.some((l) => l.includes("Volume Z-score: +2.40")));
  assert.ok(tip.some((l) => l.includes("RVOL: 3.10x")));
  assert.ok(tip.some((l) => l.includes("Quadrant: Leading")));
  assert.ok(tip.some((l) => l.includes("#1")), "ranks carried through for hover context");
  const unknownTip = QD.formatPvScatterTooltip(byQuadrant.DDD.data[0]);
  assert.ok(unknownTip.some((l) => l.includes("ไม่ทราบ")), "unknown quadrant says so plainly instead of showing blank");
  const negTip = QD.formatPvScatterTooltip({ ticker: "BBB", shortName: "Beta", x: -8, y: -1.2, quadrant: "Lagging" });
  assert.ok(negTip.some((l) => l.includes("-8.00%")) && negTip.some((l) => l.includes("-1.20")), "negatives keep their own sign");
  assert.strictEqual(QD.formatPvScatterTooltip(null).length, 0, "a missing point yields no tooltip lines instead of throwing");
  console.log("[ok] Price-Volume scatter tooltip shows ticker, both axes, RVOL, quadrant and ranks");

  // ---- buildLeaderboardChartDatasets: pure shaping ----
  const chartRows = [
    { ticker: "A", trailingReturnPct: 10, smaSignal: { pass: true } },
    { ticker: "B", trailingReturnPct: -5, smaSignal: { pass: false } },
    { ticker: "SPY", trailingReturnPct: 3, smaSignal: { pass: true } }
  ];
  const lbChart = QD.buildLeaderboardChartDatasets(chartRows, "SPY", 20);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(lbChart.labels)), ["A", "B", "SPY"]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(lbChart.colors)), ["#059669", "#dc2626", "#059669"]);
  assert.strictEqual(lbChart.benchmarkValue, 3);
  console.log("[ok] buildLeaderboardChartDatasets shapes data correctly for Chart.js");

  // ---- computeDefaultRrgSelection / buildRrgCheckboxItems / buildRotationSummaryRows (RRG redesign) ----
  const rrgLeaderboardRows = [
    { instrumentId: 30, ticker: "AAA", rank: 1, trailingReturnPct: 20 },
    { instrumentId: 31, ticker: "BBB", rank: 2, trailingReturnPct: 15 },
    { instrumentId: 32, ticker: "CCC", rank: 3, trailingReturnPct: 10 },
    { instrumentId: 33, ticker: "BENCH", rank: 4, trailingReturnPct: 5 } // benchmark, excluded from rotationIds
  ];
  const rrgRotationIds = [30, 31, 32, 99]; // 99 = no leaderboard rank (insufficient history)
  const defaultSel = QD.computeDefaultRrgSelection(rrgLeaderboardRows, rrgRotationIds, 2);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(defaultSel)), [30, 31], "Top-2 by Trailing Return among the rotation universe only (benchmark excluded upstream)");

  const rrgCbItems = QD.buildRrgCheckboxItems(
    [{ id: 30, ticker: "AAA" }, { id: 32, ticker: "CCC" }, { id: 99, ticker: "ZZZ" }, { id: 31, ticker: "BBB" }],
    rrgLeaderboardRows
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rrgCbItems.map((i) => i.ticker))), ["AAA", "BBB", "CCC", "ZZZ"], "sorted by Leaderboard rank first, unranked tickers appended alphabetically last");
  assert.strictEqual(rrgCbItems[3].rank, null);

  const rrgResults = [
    { instrumentId: 30, ticker: "AAA", points: [{ x: 101, y: 102, octant: "Leading – Strong" }, { x: 103, y: 104, octant: "Leading – Accelerating" }] },
    { instrumentId: 31, ticker: "BBB", points: [] }, // no points -> excluded from the summary table
    { instrumentId: 32, ticker: "CCC", points: [{ x: 95, y: 90, octant: "Lagging – Weak" }] } // only 1 point -> T-1 is null
  ];
  const summaryRows = QD.buildRotationSummaryRows(rrgResults, [30, 32]);
  assert.strictEqual(summaryRows.length, 2, "BBB has no points and is excluded even though selected");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(summaryRows[0])), { instrumentId: 30, ticker: "AAA", shortName: "AAA", currentState: "Leading – Accelerating", t1State: "Leading – Strong", rsRatio: 103, rsMomentum: 104, volZScore: null, volRvol: null }, "volume columns present but null when no anomaly map is supplied (backward-compatible 2-arg call)");
  assert.strictEqual(summaryRows[1].t1State, null, "single-point series has no T-1 state");

  // same call WITH an anomaly map (2026-09 volume overlay) fills the 2 new columns
  const summaryRowsVol = QD.buildRotationSummaryRows(rrgResults, [30, 32], { 30: { zScore: 2.5, rvol: 1.8 } });
  assert.ok(Math.abs(summaryRowsVol[0].volZScore - 2.5) < 1e-12);
  assert.ok(Math.abs(summaryRowsVol[0].volRvol - 1.8) < 1e-12);
  assert.strictEqual(summaryRowsVol[1].volZScore, null, "instrument missing from the anomaly map stays null, not an error");
  console.log("[ok] computeDefaultRrgSelection / buildRrgCheckboxItems / buildRotationSummaryRows (RRG redesign, item 4+6) compute correctly");

  // ---- fetchPeriodEndCloses: pagination across multiple .range() pages ----
  // Reproduces the real production bug and its fix: BIG1 has 5000 rows (>1
  // page at PAGE_SIZE=4000) and BIG2 has 1 row that lands entirely on the
  // 2nd page. Before the fix, a single un-paginated request would have
  // silently dropped everything past row 1000 (or whatever the API's Max
  // Rows cap is) -- BIG2 would have vanished entirely, exactly like
  // IEF/VNQ did in production. Verify every row survives, none duplicated.
  periodEndClosesCallLog.length = 0;
  const bigRows = await QD.fetchPeriodEndCloses(["BIG1", "BIG2"], "month", null, null);
  assert.strictEqual(bigRows.length, 5001, "all 5000 BIG1 rows + 1 BIG2 row must come back, none lost at the page boundary");
  assert.ok(periodEndClosesCallLog.length >= 2, "5001 rows at PAGE_SIZE=4000 must take at least 2 page-requests, not 1");
  const big1Rows = bigRows.filter((r) => r.instrument_id === "BIG1");
  const big2Rows = bigRows.filter((r) => r.instrument_id === "BIG2");
  assert.strictEqual(big1Rows.length, 5000, "BIG1 fully reassembled across pages");
  assert.strictEqual(big2Rows.length, 1, "BIG2 (entirely on page 2) is not dropped");
  const seenPeriods = new Set(big1Rows.map((r) => r.period_end));
  assert.strictEqual(seenPeriods.size, 5000, "no duplicate rows introduced by the pagination loop");
  console.log("[ok] fetchPeriodEndCloses pages through multiple .range() requests and reassembles the full, deduplicated result");

  // ---- DOM/integration: tab switching lazily loads Momentum data ----
  QD.state.momentum.universeMode = "asset_class";
  QD.state.momentum.timeframe = "month";
  QD.state.momentum.lookbackPeriods = 2;
  QD.state.momentum.smaPeriods = 2;
  QD.state.momentum.benchmarkAssetId = 1; // SPY
  assert.strictEqual(window.document.getElementById("tabMomentum").classList.contains("hidden"), true, "momentum tab starts hidden");
  assert.strictEqual(QD.state.momentum.dataLoaded, false, "momentum data not fetched until the tab is opened (lazy load)");
  QD.switchTab("momentum");
  await flush();
  assert.strictEqual(window.document.getElementById("tabMomentum").classList.contains("hidden"), false, "momentum tab now visible");
  assert.strictEqual(window.document.getElementById("tabSeasonality").classList.contains("hidden"), true, "seasonality tab hidden while on momentum");
  assert.strictEqual(window.document.getElementById("tabBtnMomentum").classList.contains("qd-tab-active"), true);
  assert.strictEqual(QD.state.momentum.dataLoaded, true, "switching to the tab triggered loadMomentumUniverseData");
  console.log("[ok] switchTab lazily triggers loadMomentumUniverseData exactly once, on first visit");

  // =====================================================================
  // Volume Anomaly -- pure math, now on the LOG scale
  // =====================================================================
  // Ground truth is re-derived here from the raw numbers with explicit
  // formulas (not by calling the implementation): baseline = the 12 values
  // BEFORE the current one, in log space, sample SD.
  const volSeriesGt = [100, 120, 90, 150, 110, 130, 400].map((v, i) => ({ period_end: `V${i}`, volume: v }));
  const gtWin = [120, 90, 150, 110, 130].map(Math.log);
  const gtMeanLog = gtWin.reduce((a, b) => a + b, 0) / gtWin.length;
  const gtSdLog = Math.sqrt(gtWin.reduce((a, b) => a + (b - gtMeanLog) * (b - gtMeanLog), 0) / (gtWin.length - 1));

  assert.strictEqual(QD.logVolume(0), null, "zero-volume sessions are excluded rather than treated as 'extremely quiet'");
  assert.strictEqual(QD.logVolume(null), null);
  assert.ok(Math.abs(QD.logVolume(100) - Math.log(100)) < 1e-12);

  const volBase = QD.volumeBaselineStats(volSeriesGt.map((p) => QD.logVolume(p.volume)), 6, 5);
  assert.ok(Math.abs(volBase.meanLog - gtMeanLog) < 1e-12, "baseline mean is computed in log space, excluding the current observation");
  assert.ok(Math.abs(volBase.sdLog - gtSdLog) < 1e-12);
  assert.ok(Math.abs(volBase.geoMean - Math.exp(gtMeanLog)) < 1e-12, "geometric mean is exp(mean log)");

  const volAnom = QD.computeVolumeAnomaly(volSeriesGt, 5);
  assert.ok(Math.abs(volAnom.zScore - (Math.log(400) - gtMeanLog) / gtSdLog) < 1e-12, "z-score is measured on log volume");
  assert.ok(Math.abs(volAnom.rvol - 400 / Math.exp(gtMeanLog)) < 1e-12, "RVOL divides by the same geometric mean the z-score uses");
  assert.ok(Math.abs(volAnom.mean - Math.exp(gtMeanLog)) < 1e-12);
  assert.strictEqual(volAnom.periodEnd, "V6");
  assert.ok(QD.computeVolumeAnomaly(volSeriesGt, 6), "a baseline exactly filling the available history still computes");
  assert.strictEqual(QD.computeVolumeAnomaly(volSeriesGt, 7), null, "not enough history -> null, not a throw");

  // THE POINT OF THE LOG SWITCH: symmetry. Doubling and halving must be
  // equal-and-opposite, which is exactly what raw-volume z-scores got wrong.
  const flat = [100, 100, 100, 100];
  const doubled = QD.computeVolumeAnomaly(flat.concat([200]).map((v, i) => ({ period_end: `S${i}`, volume: v })), 4);
  const halved = QD.computeVolumeAnomaly(flat.concat([50]).map((v, i) => ({ period_end: `S${i}`, volume: v })), 4);
  assert.strictEqual(doubled.zScore, null, "a zero-variance baseline still yields null rather than Infinity");
  assert.ok(Math.abs(doubled.rvol - 2) < 1e-12);
  assert.ok(Math.abs(halved.rvol - 0.5) < 1e-12);
  const wobble = [100, 110, 90, 105, 95, 100, 108, 92, 103, 97];
  const wobbleGeo = Math.exp(wobble.map(Math.log).reduce((a, b) => a + b, 0) / wobble.length);
  const volUpSeries = wobble.concat([wobbleGeo * 2]).map((v, i) => ({ period_end: `W${i}`, volume: v }));
  const volDownSeries = wobble.concat([wobbleGeo / 2]).map((v, i) => ({ period_end: `W${i}`, volume: v }));
  const zUp = QD.computeVolumeAnomaly(volUpSeries, 10).zScore;
  const zDown = QD.computeVolumeAnomaly(volDownSeries, 10).zScore;
  assert.ok(Math.abs(zUp + zDown) < 1e-9,
    `twice-normal and half-normal must be exact mirror images on the log scale (got ${zUp.toFixed(4)} vs ${zDown.toFixed(4)})`);
  assert.ok(zDown < -2, "which is what finally makes the 'unusually quiet' side reachable at all");
  // the same pair on RAW volume is visibly lopsided -- the defect this replaces
  const rawMean = wobble.reduce((a, b) => a + b, 0) / wobble.length;
  const rawSd = Math.sqrt(wobble.reduce((a, b) => a + (b - rawMean) * (b - rawMean), 0) / (wobble.length - 1));
  const rawZUp = (wobbleGeo * 2 - rawMean) / rawSd;
  const rawZDown = (wobbleGeo / 2 - rawMean) / rawSd;
  assert.ok(Math.abs(rawZUp + rawZDown) > 5,
    `on raw volume the same two events are NOT mirror images (${rawZUp.toFixed(2)} vs ${rawZDown.toFixed(2)}) -- this is the bug the log scale fixes`);
  console.log("[ok] Volume maths on the log scale: baseline/geometric mean/z/RVOL re-derived by hand, and ×2 vs ÷2 now mirror exactly");

  // ---- rolling band series (multiplicative) ----
  const bandSeries = QD.computeVolumeBandSeries(volSeriesGt, 5);
  assert.strictEqual(bandSeries.length, volSeriesGt.length, "one band row per input period");
  assert.strictEqual(bandSeries[0].mean, null, "no baseline available yet at the left edge");
  const lastBand = bandSeries[bandSeries.length - 1];
  assert.ok(Math.abs(lastBand.mean - Math.exp(gtMeanLog)) < 1e-12);
  assert.ok(Math.abs(lastBand.upper2 - Math.exp(gtMeanLog + 2 * gtSdLog)) < 1e-9);
  assert.ok(Math.abs(lastBand.lower2 - Math.exp(gtMeanLog - 2 * gtSdLog)) < 1e-9);
  assert.ok(lastBand.lower2 > 0, "log-space bands can never reach zero, so no clipping hack is needed");
  assert.ok(Math.abs((lastBand.upper1 / lastBand.mean) - (lastBand.mean / lastBand.lower1)) < 1e-9,
    "bands are symmetric as RATIOS around the geometric mean");
  console.log("[ok] Volume band series: multiplicative ±1SD/±2SD around the geometric mean, positive by construction");

  // ---- magnitude + two-sided colour scale ----
  assert.ok(Math.abs(QD.volumeAnomalyMagnitude({ zScore: -3 }) - 3) < 1e-12, "a quiet-volume outlier is as 'unusual' as a spike");
  assert.strictEqual(QD.volumeAnomalyMagnitude({ zScore: null }), null);
  const symRange = QD.computeSymmetricRange([-3, 1, 0.5], 0);
  assert.strictEqual(symRange.maxAbs, 3, "diverging range is symmetric around the centre");
  assert.ok(QD.volumeDivergingColor(3, symRange).startsWith("hsl(25"), "high volume -> orange end");
  assert.ok(QD.volumeDivergingColor(-3, symRange).startsWith("hsl(215"), "low volume -> blue end");
  assert.ok(QD.volumeDivergingColor(0, symRange).includes("97%"), "centre of the scale is the palest shade");
  assert.strictEqual(QD.volumeDivergingColor(null, symRange), null);
  assert.strictEqual(QD.volumeDivergingColor(1, { center: 0, maxAbs: 0 }), "hsl(50, 20%, 92%)", "no spread -> neutral colour, no divide-by-zero");
  console.log("[ok] Volume: anomaly magnitude (two-sided) + symmetric diverging colour scale");

  // (d) the RRG halo mapping (point SIZE is left to tail recency, ring carries volume)
  assert.strictEqual(QD.volumeHaloColor({ zScore: 2.5 }), "#ea580c");
  assert.strictEqual(QD.volumeHaloColor({ zScore: -2.5 }), "#2563eb");
  assert.strictEqual(QD.volumeHaloColor({ zScore: 1.9 }), null, "inside the normal band -> no ring");
  assert.strictEqual(QD.volumeHaloColor(null), null);
  const haloPoints = [{ x: 100, y: 100 }, { x: 101, y: 101 }, { x: 102, y: 102 }];
  const styledHalo = QD.buildRotationPointStyles(haloPoints, "#2563eb", { zScore: 3 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(styledHalo.pointBorderWidth)), [0, 0, 3], "only the latest point gets the ring");
  assert.strictEqual(styledHalo.pointBorderColor[2], "#ea580c");
  assert.ok(styledHalo.pointRadius[2] > styledHalo.pointRadius[0], "size still encodes tail recency, unchanged by the volume overlay");
  const styledNoHalo = QD.buildRotationPointStyles(haloPoints, "#2563eb", null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(styledNoHalo.pointBorderWidth)), [0, 0, 0]);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(styledNoHalo.pointRadius)), JSON.parse(JSON.stringify(styledHalo.pointRadius)),
    "adding a halo must not change point sizes (backward compatibility with the existing recency encoding)"
  );
  console.log("[ok] RRG volume halo: ring only on the latest point, never touches the size-encodes-recency channel");

  // (e) tooltip text builder
  const tipPlain = QD.formatRotationTooltip("AAA", { x: 101.234, y: 99.5, octant: "Leading – Strong" });
  assert.strictEqual(tipPlain, "AAA: (101.2, 99.5) — Leading – Strong", "unchanged for points without volume data");
  const tipVol = QD.formatRotationTooltip("AAA", { x: 101.2, y: 99.5, octant: "Leading – Strong", volZ: 2.34, volRvol: 1.8 });
  assert.ok(Array.isArray(tipVol) && tipVol.length === 2);
  assert.strictEqual(tipVol[1], "Volume Z: +2.34 (RVOL 1.80x)");
  assert.strictEqual(QD.formatRotationTooltip("A", { x: 1, y: 2, volZ: -2.5 })[1], "Volume Z: -2.50");
  console.log("[ok] RRG tooltip appends the Volume Z line only where volume data exists");

  // =====================================================================
  // Correlation Explorer (2026-09) -- pure math vs numpy ground truth
  // =====================================================================
  // Prices generated with numpy (seeded); correlations of their simple
  // returns computed independently with numpy.corrcoef.
  const CORR_PA = [100.1025,100.8007,100.3488,98.6618,97.8632,96.0202,96.2317,98.9074,98.0326,96.9141,97.9605,98.7577,99.0646,97.3202,97.3605,98.8118,96.2541,95.4694,91.9347,89.6556,86.4428,86.1228,84.0258,84.5657,84.9154,84.6828,80.505,79.7182,79.7205,79.9809];
  const CORR_PB = [97.0397,96.2095,94.4229,92.9899,95.0559,93.6158,93.6485,95.3986,94.3805,94.264,94.5665,94.7817,92.5542,92.7877,95.4022,92.5455,94.2287,94.5479,93.4294,97.2608,98.8409,96.5689,96.8094,98.0228,97.7507,99.1836,99.1508,100.5731,103.5672,102.2713];
  const CORR_GT_LAST10 = -0.04425618729154348;
  const CORR_GT_PREV10 = -0.06673075889195348;
  const CORR_GT_FULL = -0.09939533073698145;
  const corrItems = [
    { instrumentId: 501, ticker: "PA", series: CORR_PA.map((p, i) => ({ period_end: `C${String(i).padStart(2, "0")}`, adj_close: p })) },
    { instrumentId: 502, ticker: "PB", series: CORR_PB.map((p, i) => ({ period_end: `C${String(i).padStart(2, "0")}`, adj_close: p })) }
  ];
  assert.ok(Math.abs(QD.pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12, "perfectly correlated");
  assert.ok(Math.abs(QD.pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-12, "perfectly anti-correlated");
  assert.strictEqual(QD.pearson([1, 1, 1], [1, 2, 3]), null, "zero-variance input -> null, not NaN");

  const corrMatrix10 = QD.computeCorrelationMatrix(corrItems, 10);
  assert.strictEqual(corrMatrix10.values[0][0], 1, "diagonal is exactly 1");
  assert.ok(Math.abs(corrMatrix10.values[0][1] - CORR_GT_LAST10) < 1e-10, "matrix cell matches numpy.corrcoef over the last 10 returns");
  assert.strictEqual(corrMatrix10.values[0][1], corrMatrix10.values[1][0], "matrix is symmetric");
  const corrMatrixFull = QD.computeCorrelationMatrix(corrItems, 29);
  assert.ok(Math.abs(corrMatrixFull.values[0][1] - CORR_GT_FULL) < 1e-10, "full-window correlation matches numpy ground truth");

  const rollingPair = QD.computeRollingPairCorrelation(corrMatrix10.aligned, 501, 502, 10);
  assert.ok(Math.abs(rollingPair[rollingPair.length - 1].corr - CORR_GT_LAST10) < 1e-10, "last rolling point == the matrix value");
  assert.ok(Math.abs(rollingPair[rollingPair.length - 2].corr - CORR_GT_PREV10) < 1e-10, "the point before it matches the window shifted back by one");

  // overlap handling: an instrument whose history starts late still pairs up
  // on the dates both actually have returns (no global date-dropping).
  const shortItem = { instrumentId: 503, ticker: "PC", series: CORR_PA.slice(20).map((p, i) => ({ period_end: `C${String(i + 20).padStart(2, "0")}`, adj_close: p })) };
  const corrShort = QD.computeCorrelationMatrix([corrItems[0], shortItem], 10);
  assert.ok(Math.abs(corrShort.values[0][1] - 1) < 1e-9, "identical (overlapping) price paths correlate at 1 despite different start dates");
  const tooShort = { instrumentId: 504, ticker: "PD", series: CORR_PA.slice(27).map((p, i) => ({ period_end: `C${String(i + 27).padStart(2, "0")}`, adj_close: p })) };
  assert.strictEqual(QD.computeCorrelationMatrix([corrItems[0], tooShort], 10).values[0][1], null, "fewer overlapping observations than the minimum -> null rather than a noisy 2-point correlation");

  const avgSeries = QD.computeAverageCorrelationSeries(corrMatrix10.aligned, [501, 502], 10, 100);
  assert.ok(avgSeries.length > 0);
  assert.ok(Math.abs(avgSeries[avgSeries.length - 1].avgCorr - CORR_GT_LAST10) < 1e-10, "with a single pair the average equals that pair's correlation");
  assert.strictEqual(avgSeries[avgSeries.length - 1].pairCount, 1);
  const avgCapped = QD.computeAverageCorrelationSeries(corrMatrix10.aligned, [501, 502], 10, 3);
  assert.ok(avgCapped.length <= 3, "evaluation points are subsampled to the requested cap");
  assert.ok(QD.correlationColor(1).startsWith("hsl(0"), "+1 -> red end");
  assert.ok(QD.correlationColor(-1).startsWith("hsl(215"), "-1 -> blue end");
  console.log("[ok] Correlation: pearson / matrix / rolling pair / average series cross-checked against numpy.corrcoef ground truth (incl. partial-overlap + min-overlap rules)");

  // ---- Merged table: momentum half loads first (progressive render) ----
  // Only EFA/EEM/SPY have mock price data among the 6 Asset Class tickers
  // (IEF/VNQ/DBC have none) -- they are excluded rather than erroring the
  // whole table. Rank order matches the by-hand trailing-return calc above.
  const mergedRows = QD.state.momentum.rows;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.sortedMomentumRows().map((r) => r.ticker))), ["EFA", "EEM", "SPY"],
    "default sort is Trailing Return desc -- same order the old Leaderboard produced (backward compatible)");
  assert.strictEqual(mergedRows.length, 3);
  const tableRows = window.document.querySelectorAll("#momLeaderboardTable tbody tr");
  assert.strictEqual(tableRows.length, 3);
  console.log("[ok] merged table loads via period_end_closes + period_volume_series and ranks correctly, excluding tickers with no data");

  // ---- price fetch is now BOUNDED (the 41-page full-history pull is gone) ----
  const lastPriceFetch = periodEndClosesCallLog[periodEndClosesCallLog.length - 1];
  assert.ok(lastPriceFetch.params.p_start_date, "price fetch carries p_start_date instead of pulling full history");
  assert.ok(QD.momentumPriceLookbackPeriods() >= Math.max(QD.state.momentum.lookbackPeriods, QD.state.momentum.smaPeriods),
    "the bounded window covers the longest parameter in play");
  console.log("[ok] price fetch is bounded by p_start_date (the unbounded full-history pull is gone)");

  // ---- volume side: log-based Z, geometric-mean baseline, union rows ----
  const efaRow = mergedRows.find((r) => r.ticker === "EFA");
  const eemRow = mergedRows.find((r) => r.ticker === "EEM");
  const spyRow = mergedRows.find((r) => r.ticker === "SPY");
  assert.ok(Math.abs(efaRow.volZScore - EXPECTED_LOG_Z(3000)) < 1e-9, "EFA volume Z matches the hand-derived log-space baseline");
  assert.ok(eemRow.volZScore < -2, "EEM (volume dried up) now produces a large NEGATIVE z -- impossible under the old raw-volume formula");
  assert.strictEqual(spyRow.isAnomaly, false, "SPY sits inside its own normal band");
  assert.strictEqual(efaRow.isAnomaly, true);
  assert.strictEqual(eemRow.isAnomaly, true);
  assert.ok(Math.abs(efaRow.meanVolume - VOL_GEO_MEAN) < 1e-6, "baseline column shows the geometric mean (the same reference the z-score uses)");
  assert.ok(Math.abs(efaRow.rvol - 3000 / VOL_GEO_MEAN) < 1e-9, "RVOL divides by that same geometric mean");
  // On the LOG scale the dry-up (÷10) is a bigger deviation than the spike
  // (×3), so EEM outranks EFA -- the opposite of what the old raw-volume
  // formula produced, and the correct answer: ln(0.1) = -2.30 vs ln(3) = +1.10.
  assert.strictEqual(eemRow.volRank, 1, "volume rank is by |z| in log space -- the ÷10 dry-up ranks first");
  assert.strictEqual(efaRow.volRank, 2, "...ahead of the ×3 spike");
  assert.strictEqual(spyRow.volRank, 3);
  assert.ok(Math.abs(eemRow.volZScore) > Math.abs(efaRow.volZScore));
  console.log("[ok] merged rows carry log-based Volume Z, geometric-mean baseline and a |z|-based Volume rank");

  // ---- union rule: a row survives with only one half of the data ----
  const unionRows = QD.buildMergedRows(
    [{ id: 901, ticker: "PRICEONLY", category: "test" }, { id: 902, ticker: "VOLONLY", category: "test" }, { id: 903, ticker: "NEITHER", category: "test" }],
    { 901: [1, 2, 3, 4].map((p, i) => ({ period_end: `U${i}`, adj_close: 100 + p })) },
    { 902: VOL_PATTERN.concat([3000]).map((v, i) => ({ period_end: `U${i}`, volume: v, adj_close: 10 })) },
    { lookbackPeriods: 2, smaPeriods: 2, riskAdjusted: false, riskFreeAnnualPct: 0, periodsPerYear: 12 },
    12
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(unionRows.map((r) => r.ticker))), ["PRICEONLY", "VOLONLY"],
    "union: rows with either half survive; a row with neither is dropped");
  assert.strictEqual(unionRows[0].volZScore, null, "price-only row leaves the volume columns empty rather than vanishing");
  assert.strictEqual(unionRows[1].trailingReturnPct, null, "volume-only row leaves the momentum columns empty");
  assert.strictEqual(unionRows[0].momRank, 1);
  assert.strictEqual(unionRows[1].momRank, null);
  console.log("[ok] buildMergedRows uses UNION with '—' for the missing half, never silently dropping an instrument");

  // ---- sorting: every column, nulls always last ----
  const sortDesc = QD.sortMergedRows(mergedRows, "trailingReturnPct", "desc").map((r) => r.ticker);
  const sortAsc = QD.sortMergedRows(mergedRows, "trailingReturnPct", "asc").map((r) => r.ticker);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sortAsc)), JSON.parse(JSON.stringify(sortDesc.slice().reverse())));
  const withNull = mergedRows.concat([{ instrumentId: 999, ticker: "ZZZ", shortName: "ZZZ", category: "x", trailingReturnPct: null, volZScore: null, momRank: null, volRank: null }]);
  ["desc", "asc"].forEach((dir) => {
    const sorted = QD.sortMergedRows(withNull, "trailingReturnPct", dir);
    assert.strictEqual(sorted[sorted.length - 1].ticker, "ZZZ", `nulls sink to the bottom in ${dir} order too`);
  });
  const byTicker = QD.sortMergedRows(mergedRows, "ticker", "asc").map((r) => r.ticker);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(byTicker)), ["EEM", "EFA", "SPY"], "string columns sort alphabetically");
  console.log("[ok] sortMergedRows: numeric + string columns, both directions, nulls always last");

  // ---- clicking a header sorts the table AND redraws both charts from that order ----
  const headerFor = (colId) => Array.from(window.document.querySelectorAll("#momLeaderboardTable thead .mom-col-sort"))
    .find((el) => el.getAttribute("data-sort-col") === colId);
  headerFor("volZScore").dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.strictEqual(QD.state.momentum.table.sortColumn, "volZScore");
  assert.strictEqual(QD.state.momentum.table.sortDir, "desc");
  const afterVolSort = QD.sortedMomentumRows().map((r) => r.ticker);
  assert.strictEqual(afterVolSort[0], "EFA", "sorting by Volume Z puts the spike on top");
  assert.strictEqual(afterVolSort[afterVolSort.length - 1], "EEM", "...and the dry-up at the bottom (signed sort)");
  const chartAfterSort = QD.buildLeaderboardChartDatasets(QD.sortedMomentumRows(), "SPY", 20);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(chartAfterSort.labels)), JSON.parse(JSON.stringify(afterVolSort)),
    "the Trailing Return chart follows the table's sort order, not its own ranking");
  const volChartAfterSort = QD.buildVolumeChartDatasets(QD.sortedMomentumRows(), 20);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(volChartAfterSort.labels)), JSON.parse(JSON.stringify(afterVolSort)),
    "both charts share the same x-axis order");
  assert.strictEqual(volChartAfterSort.colors[0], "#ea580c", "positive z bars are orange");
  assert.strictEqual(volChartAfterSort.colors[volChartAfterSort.labels.indexOf("EEM")], "#2563eb", "negative z bars are blue");
  // clicking the same header again flips direction
  headerFor("volZScore").dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.strictEqual(QD.state.momentum.table.sortDir, "asc");
  console.log("[ok] header click sorts the table, flips on re-click, and both charts follow that order");

  // ---- column visibility + reordering ----
  QD.applyTablePreset("all");
  const allCols = QD.visibleOrderedColumns().map((c) => c.id);
  assert.strictEqual(allCols.length, QD.MOMENTUM_COLUMN_IDS.length, "preset 'all' shows every column");
  assert.strictEqual(QD.toggleColumn("riskAdjScore", false), true);
  assert.ok(!QD.visibleOrderedColumns().some((c) => c.id === "riskAdjScore"), "unticked column disappears");
  assert.strictEqual(QD.toggleColumn("row", false), false, "fixed columns cannot be hidden");
  assert.ok(QD.visibleOrderedColumns()[0].id === "row");
  QD.toggleColumn("riskAdjScore", true);

  const orderBefore = QD.state.momentum.table.order.slice();
  const movedId = orderBefore[3];
  assert.strictEqual(QD.moveColumn(movedId, -1), true);
  assert.strictEqual(QD.state.momentum.table.order[2], movedId, "◀ moves the column one slot left");
  assert.strictEqual(QD.moveColumn(movedId, 1), true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.state.momentum.table.order)), JSON.parse(JSON.stringify(orderBefore)), "▶ moves it back");
  assert.strictEqual(QD.moveColumn(orderBefore[0], -1), false, "cannot move the leftmost column further left");
  assert.strictEqual(QD.moveColumn(orderBefore[orderBefore.length - 1], 1), false, "cannot move the rightmost column further right");
  QD.renderMomentumLeaderboard();
  const moveBtns = window.document.querySelectorAll("#momLeaderboardTable thead .mom-col-move");
  assert.ok(moveBtns.length >= 2, "every header carries ◀ ▶ buttons");
  const secondColBefore = QD.state.momentum.table.order[1];
  Array.from(moveBtns).find((b) => b.getAttribute("data-col") === secondColBefore && b.getAttribute("data-delta") === "-1")
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.strictEqual(QD.state.momentum.table.order[0], secondColBefore, "clicking ◀ in the DOM really reorders");
  QD.applyTablePreset("all");
  console.log("[ok] column visibility (fixed columns protected) + ◀▶ reordering, both through the API and real DOM clicks");

  // ---- view presets ----
  QD.applyTablePreset("momentum");
  assert.strictEqual(QD.state.momentum.table.sortColumn, "trailingReturnPct");
  assert.ok(!QD.visibleOrderedColumns().some((c) => c.id === "volZScore"), "Momentum preset hides the volume detail columns");
  assert.ok(QD.visibleOrderedColumns().some((c) => c.id === "volRank"), "...but keeps the Volume RANK for cross-referencing");
  QD.applyTablePreset("volume");
  assert.strictEqual(QD.state.momentum.table.sortColumn, "volRank");
  assert.strictEqual(QD.state.momentum.table.sortDir, "asc", "Volume preset sorts by |z| rank, so a dry-up ranks alongside a spike");
  const volPresetOrder = QD.sortedMomentumRows().map((r) => r.ticker);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(volPresetOrder)), ["EEM", "EFA", "SPY"],
    "spike AND dry-up both outrank the normal one (ranked by |z|, dry-up largest here)");
  assert.ok(QD.visibleOrderedColumns().some((c) => c.id === "momRank"), "Volume preset keeps the Momentum rank column");
  QD.applyTablePreset("all");
  console.log("[ok] view presets set columns + sort in one click (Momentum / Volume / ทั้งหมด)");

  // ---- layout persistence ----
  QD.toggleColumn("category", false);
  QD.setSort("rvol");
  const savedLayout = QD.loadLayout();
  assert.ok(savedLayout, "layout was written to localStorage");
  assert.strictEqual(savedLayout.visible.category, false);
  assert.strictEqual(savedLayout.sortColumn, "rvol");
  // a layout saved by an older build must not be able to break the table
  const dirty = QD.sanitizeLayout({ order: ["ticker", "__GONE__", "rvol"], visible: { __GONE__: true, ticker: false }, sortColumn: "__GONE__", sortDir: "sideways" });
  assert.ok(!dirty.order.includes("__GONE__"), "unknown column ids are dropped");
  assert.strictEqual(dirty.order.length, QD.MOMENTUM_COLUMN_IDS.length, "columns added since the layout was saved are appended");
  assert.strictEqual(dirty.sortColumn, "trailingReturnPct", "an unknown sort column falls back to the default");
  assert.strictEqual(dirty.sortDir, "desc", "an invalid direction falls back to desc");
  QD.resetTableLayout();
  assert.strictEqual(QD.loadLayout(), null, "reset clears the stored layout");
  assert.strictEqual(QD.state.momentum.table.preset, "all");
  assert.strictEqual(QD.state.momentum.table.visible.category, true, "reset restores every column");
  console.log("[ok] table layout persists to localStorage, is validated on load, and the reset button clears it");

  // ---- instrument selection drives table + charts, without refetching ----
  const fetchesBeforeSelToggle = periodEndClosesCallLog.length + periodVolumeCallLog.length;
  const eemSelCb = Array.from(window.document.querySelectorAll("#momSelectionPanel .mom-sel-cb"))
    .find((cb) => cb.getAttribute("data-inst-id") === "11");
  eemSelCb.checked = false;
  eemSelCb.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.strictEqual(periodEndClosesCallLog.length + periodVolumeCallLog.length, fetchesBeforeSelToggle, "unticking never triggers a fetch");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.sortedMomentumRows().map((r) => r.ticker))), ["EFA", "SPY"], "EEM leaves the table immediately");
  eemSelCb.checked = true;
  eemSelCb.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.strictEqual(QD.state.momentum.rows.length, 3, "re-ticking restores it");
  console.log("[ok] instrument selection panel filters table + charts from memory, with no network call");

  // ---- Risk-free rate autofill (still wired after the merge) ----
  await QD.autofillRiskFreeRate();
  assert.strictEqual(QD.state.momentum.riskFreeAnnualPct, 4.33, "defaults to FEDFUNDS source");
  assert.strictEqual(window.document.getElementById("momRiskFreeRate").value, "4.33");
  console.log("[ok] autofillRiskFreeRate pulls the latest FEDFUNDS value from macro_series");

  // ---- runMomentumCalculate: RRG + volume overlay, no redundant refetch ----
  const fetchesBeforeCalc = periodEndClosesCallLog.length;
  await QD.runMomentumCalculate();
  await flush(5);
  assert.strictEqual(periodEndClosesCallLog.length, fetchesBeforeCalc, "nothing in the fetch key changed -> no re-fetch");
  assert.ok(QD.state.momentum.rotationData, "rotation data computed");
  assert.strictEqual(QD.state.momentum.rrgSelectedIds.length, 2, "default RRG selection = Top-N of the CURRENT table order (only 2 non-benchmark instruments exist here)");
  const anomalyMap = QD.state.momentum.volumeAnomalyById;
  assert.ok(anomalyMap[10] && anomalyMap[11], "EFA/EEM anomalies feed the RRG overlay");
  assert.strictEqual(anomalyMap[1], undefined, "the benchmark is not part of the rotation universe");
  assert.ok(Math.abs(anomalyMap[10].zScore - efaRow.volZScore) < 1e-12,
    "the RRG overlay and the table read the exact same anomaly numbers (no parallel engine)");
  console.log("[ok] runMomentumCalculate drives the RRG from the same rows/anomalies as the table, without re-fetching");

  // ---- Price-Volume scatter: REAL render path, real state, stubbed Chart.js ----
  // Chart.js is absent under jsdom, so stub it to capture what the renderer
  // actually hands the charting library -- this exercises renderPriceVolumeScatter()
  // end to end (state -> quadrant map -> datasets -> chart config), not just
  // the pure helper in isolation.
  const chartCalls = [];
  window.Chart = function (ctx, config) {
    chartCalls.push(config);
    this.destroy = function () { this.destroyed = true; };
  };
  QD.renderMomentumLeaderboard();
  const pvConfig = chartCalls.filter((c) => c.options && c.options.scales && c.options.scales.y &&
    c.options.scales.y.title && String(c.options.scales.y.title.text).includes("Volume Z-score (log scale)")).pop();
  assert.ok(pvConfig, "the scatter really is rendered as part of the normal leaderboard render pass");
  assert.strictEqual(pvConfig.type, "scatter");
  const pvPoints = pvConfig.data.datasets.reduce((acc, d) => acc.concat(d.data.map((p) => ({ ...p, color: d.backgroundColor }))), []);
  assert.deepStrictEqual(pvPoints.map((p) => p.ticker).sort(), ["EEM", "EFA"],
    "benchmark excluded (it is the yardstick, has no quadrant) even though it IS a row in the table");
  assert.ok(QD.state.momentum.rows.some((r) => r.ticker === "SPY"), "...and the benchmark really is in the table, so this is an explicit exclusion, not an artifact");
  // independently derive what each dot's color SHOULD be, straight from state
  let coloredChecked = 0;
  QD.state.momentum.rotationData.results.forEach((r) => {
    if (!r.points.length) return; // no rotation points -> belongs in the gray group, checked separately below
    coloredChecked++;
    const last = r.points[r.points.length - 1];
    const expected = (last.y > 100) ? (last.x > 100 ? "#059669" : "#2563eb") : (last.x > 100 ? "#d97706" : "#dc2626");
    const dot = pvPoints.find((p) => p.ticker === r.ticker);
    assert.ok(dot, `${r.ticker} plotted`);
    assert.strictEqual(dot.color, expected, `${r.ticker} dot color matches the RRG zone its last point sits in (x=${last.x.toFixed(2)}, y=${last.y.toFixed(2)})`);
  });
  assert.ok(coloredChecked > 0, "at least one dot was verified against a real rotation point");
  // and that the coordinates are the same numbers the table shows
  const efaPvRow = QD.state.momentum.rows.find((r) => r.ticker === "EFA");
  const efaDot = pvPoints.find((p) => p.ticker === "EFA");
  assert.strictEqual(efaDot.x, efaPvRow.trailingReturnPct, "no parallel engine: the dot's x IS the table's Trailing Return");
  assert.strictEqual(efaDot.y, efaPvRow.volZScore, "no parallel engine: the dot's y IS the table's Volume Z-score");
  assert.strictEqual(window.document.getElementById("momPvScatterStatus").textContent, "2 instruments");
  assert.strictEqual(window.document.getElementById("momPvScatterEmpty").classList.contains("hidden"), true);
  // sorting the table must not repaint the dots
  const colorBeforeSort = pvPoints.reduce((m, p) => { m[p.ticker] = p.color; return m; }, {});
  QD.setSort("volZScore");
  QD.renderMomentumLeaderboard();
  const afterSort = chartCalls[chartCalls.length - 2];
  const sortedPvConfig = chartCalls.filter((c) => c.options && c.options.scales && c.options.scales.y &&
    String(c.options.scales.y.title.text).includes("Volume Z-score (log scale)")).pop();
  sortedPvConfig.data.datasets.forEach((d) => d.data.forEach((p) => {
    assert.strictEqual(d.backgroundColor, colorBeforeSort[p.ticker], `${p.ticker} keeps its quadrant color after the table is re-sorted`);
  }));
  assert.ok(afterSort, "re-render happened");
  // before "คำนวณ" there is no rotationData, so every dot must be gray rather than mis-colored
  const savedRotation = QD.state.momentum.rotationData;
  QD.state.momentum.rotationData = null;
  QD.renderMomentumLeaderboard();
  const grayConfig = chartCalls.filter((c) => c.options && c.options.scales && c.options.scales.y &&
    String(c.options.scales.y.title.text).includes("Volume Z-score (log scale)")).pop();
  assert.strictEqual(grayConfig.data.datasets.length, 1, "no rotation data => a single group");
  assert.strictEqual(grayConfig.data.datasets[0].backgroundColor, "#94a3b8", "...and it is the honest gray 'unknown', not a guessed quadrant");
  QD.state.momentum.rotationData = savedRotation;
  QD.setSort("trailingReturnPct");
  QD.renderMomentumLeaderboard();
  delete window.Chart;
  console.log("[ok] Price-Volume scatter renders from real state: coordinates match the table, colors match the RRG zones, gray before คำนวณ");

  // ---- RRG halo + summary columns still wired to the merged numbers ----
  const rrgDatasets = QD.buildRotationDatasets(QD.state.momentum.rotationData, QD.state.momentum.rrgSelectedIds, anomalyMap);
  const efaDs = rrgDatasets.find((d) => d.label === "EFA");
  assert.ok(efaDs, "EFA plotted");
  const lastIdx = efaDs.data.length - 1;
  assert.strictEqual(efaDs.pointBorderColor[lastIdx], "#ea580c", "spike -> orange halo on the latest point");
  assert.strictEqual(efaDs.pointBorderWidth[0], 0, "older tail points keep no ring");
  assert.ok(efaDs.data[lastIdx].volZ != null, "volume rides on the latest point for the tooltip");
  const rrgHead = Array.from(window.document.querySelectorAll("#momRotationSummaryTable thead th")).map((th) => th.textContent.trim());
  assert.ok(rrgHead.includes("Volume Z-score") && rrgHead.includes("RVOL (x)"), "summary table keeps the volume columns");
  console.log("[ok] RRG halo + summary volume columns still driven by the shared anomaly map");

  // ---- drill-down is lazy: nothing fetched until a row is clicked ----
  const volFetchesBeforeDrill = periodVolumeCallLog.length;
  assert.strictEqual(QD.state.momentum.drilldownSeries.length, 0, "no drill-down data preloaded");
  const efaTableRow = Array.from(window.document.querySelectorAll("#momLeaderboardTable tbody tr"))
    .find((tr) => tr.textContent.includes("EFA"));
  efaTableRow.dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush(6);
  assert.strictEqual(QD.state.momentum.drilldownInstrumentId, 10, "clicking a row selects that instrument");
  assert.strictEqual(periodVolumeCallLog.length, volFetchesBeforeDrill + 1, "exactly ONE extra request, for that one instrument");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(periodVolumeCallLog[periodVolumeCallLog.length - 1].params.p_instrument_ids)), [10],
    "the drill-down fetch asks for the clicked instrument only, not the whole universe");
  assert.ok(QD.state.momentum.drilldownPoints.length > 0, "band series built");
  assert.ok(window.document.getElementById("momDrilldownTitle").textContent.includes("EFA"));
  // clicking the same row again must not re-fetch (cache hit)
  const volFetchesAfterDrill = periodVolumeCallLog.length;
  efaTableRow.dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush(4);
  assert.strictEqual(periodVolumeCallLog.length, volFetchesAfterDrill, "re-clicking the same instrument uses the cache");
  console.log("[ok] drill-down loads on click for ONE instrument and caches it (no upfront全-universe history pull)");

  // ---- drill-down bands are multiplicative (log-space), never negative ----
  const drillPts = QD.state.momentum.drilldownPoints;
  const lastPt = drillPts[drillPts.length - 1];
  assert.ok(lastPt.lower2 > 0, "the lower band is exp(mean - 2sd) and therefore always positive");
  assert.ok((lastPt.upper2 / lastPt.mean) > (lastPt.mean / lastPt.lower2) - 1e-9, "bands are symmetric in ratio, not in absolute volume");
  assert.ok(Math.abs(lastPt.zScore - efaRow.volZScore) < 1e-9, "the drill-down and the table agree on the final z (same engine)");
  console.log("[ok] drill-down bands are multiplicative around the geometric mean and agree with the table");

  // ---- Export: 5 sheets, all columns regardless of what is hidden ----
  QD.toggleColumn("category", false); // hidden on screen...
  const expSheets = QD.buildMomentumExportSheets({ leaderboard: true, rotation: true, corrMatrix: false, corrAvg: false, drilldown: true });
  assert.strictEqual(expSheets.leaderboard[0].length, QD.MOMENTUM_COLUMN_IDS.length, "...but still present in the exported sheet");
  assert.ok(expSheets.leaderboard[0].includes("Category"));
  assert.strictEqual(expSheets.leaderboard.length - 1, QD.state.momentum.rows.length);
  const zColIdx = expSheets.leaderboard[0].indexOf("Volume Z-score (log)");
  assert.ok(typeof expSheets.leaderboard[1][zColIdx] === "number", "exported values are raw numbers, not formatted strings");
  const trendColIdx = expSheets.leaderboard[0].indexOf("Trend Filter");
  assert.ok(["Pass", "Fail", "N/A"].includes(expSheets.leaderboard[1][trendColIdx]), "badge columns export as plain text, not HTML");
  assert.ok(expSheets.rotation[0][0] === "Ticker");
  assert.ok(expSheets.drilldown[0].includes("Volume Z-score (log)") && expSheets.drilldown.length > 1, "drill-down history sheet");
  QD.toggleColumn("category", true);

  const expCbIds = ["momExportLeaderboard", "momExportRotation", "momExportCorrMatrix", "momExportCorrAvg", "momExportDrilldown"];
  expCbIds.forEach((id) => assert.ok(window.document.getElementById(id), `${id} checkbox exists`));
  assert.strictEqual(window.document.getElementById("momExportRotation").disabled, false, "rotation unlocks once computed");
  assert.strictEqual(window.document.getElementById("momExportDrilldown").disabled, false, "drill-down unlocks once a row was opened");
  assert.strictEqual(window.document.getElementById("momExportCorrMatrix").disabled, true, "correlation stays locked until it is computed");
  expCbIds.forEach((id) => { const el = window.document.getElementById(id); el.checked = false; });
  assert.strictEqual(QD.exportMomentumToExcel(), null, "refuses when nothing is selected");
  assert.strictEqual(window.document.getElementById("momExportError").classList.contains("hidden"), false);
  window.document.getElementById("momExportLeaderboard").checked = true;
  assert.ok(QD.exportMomentumToExcel().leaderboard, "falls back to returning sheet data when XLSX is unavailable");
  console.log("[ok] Export: 5 gated checkboxes, sheets built from the shared column registry, all columns always included");

  // =====================================================================
  // Correlation Explorer (shares the Universe, keeps its own timeframe)
  // =====================================================================
  QD.state.momentum.corr.windowPeriods = 5; // mock price series is only 7 periods long
  const priceFetchesBeforeCorr = periodEndClosesCallLog.length;
  await QD.runCorrelationCalculate();
  await flush(5);
  assert.strictEqual(periodEndClosesCallLog.length, priceFetchesBeforeCorr,
    "correlation at the same frequency as the momentum timeframe REUSES the loaded price series");
  const corrMatrixState = QD.state.momentum.corr.matrix;
  assert.ok(corrMatrixState, "matrix computed");
  assert.ok(QD.state.momentum.corr.avgSeries.length > 0, "average-correlation series computed");
  const corrCells = window.document.querySelectorAll("#corrMatrixTable .corr-cell");
  assert.strictEqual(corrCells.length, corrMatrixState.tickers.length * corrMatrixState.tickers.length);
  const offDiag = Array.from(corrCells).find((td) => td.getAttribute("data-i") !== td.getAttribute("data-j"));
  offDiag.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.ok(QD.state.momentum.corr.selectedPair && QD.state.momentum.corr.pairSeries.length > 0, "clicking a cell builds that pair's rolling history");
  QD.updateMomExportAvailability();
  assert.strictEqual(window.document.getElementById("momExportCorrMatrix").disabled, false, "correlation export unlocks once computed");
  const corrSheets = QD.buildMomentumExportSheets({ corrMatrix: true, corrAvg: true });
  assert.strictEqual(corrSheets.corrMatrix[0][0], "", "matrix sheet is an N x N grid with a blank corner cell");
  assert.strictEqual(corrSheets.corrMatrix.length - 1, corrMatrixState.tickers.length);
  assert.strictEqual(corrSheets.corrAvg[0][0], "Period End");
  QD.state.momentum.corr.frequency = "week";
  const fetchesBeforeFreq = periodEndClosesCallLog.length;
  await QD.runCorrelationCalculate();
  await flush(5);
  assert.ok(periodEndClosesCallLog.length > fetchesBeforeFreq, "a different frequency does need its own fetch");
  QD.state.momentum.corr.frequency = "month";
  console.log("[ok] Correlation Explorer: reuses loaded prices when frequencies match, fetches only when they differ, matrix + pair drill-down + export all wired");

  // ---- Day timeframe: parameter sets and the bounded fetch ----
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.MOMENTUM_TIMEFRAME_OPTIONS.day.lookbacks)), [21, 63, 126, 252],
    "Day lookbacks start at 21 sessions -- shorter horizons are reversal territory, not momentum");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.MOMENTUM_TIMEFRAME_OPTIONS.day.smas)), [50, 100, 150, 200]);
  assert.strictEqual(QD.MOMENTUM_TAIL_DEFAULTS.day, 30, "daily RRG defaults to a longer tail (daily RS-Momentum is noisy)");
  const tfEl = window.document.getElementById("momTimeframePicker");
  assert.ok(Array.from(tfEl.options).some((o) => o.value === "day"), "Day is offered in the Timeframe picker");
  tfEl.value = "day";
  tfEl.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.strictEqual(QD.state.momentum.timeframe, "day");
  assert.strictEqual(QD.state.momentum.lookbackPeriods, 63);
  assert.strictEqual(QD.state.momentum.smaPeriods, 200);
  assert.strictEqual(QD.state.momentum.volBaselinePeriods, 20, "volume baseline follows the timeframe's default");
  assert.strictEqual(QD.state.momentum.tailLength, 30);
  assert.ok(window.document.getElementById("momLookbackPicker").innerHTML.includes("63 วัน"), "picker relabels in วัน");
  const dayFetchKeyChanged = QD.computeMomentumFetchKey() !== QD.state.momentum.lastFetchKey;
  assert.ok(dayFetchKeyChanged, "switching to Day changes the fetch key (new data required)");
  tfEl.value = "month";
  tfEl.dispatchEvent(new window.Event("change", { bubbles: true }));
  console.log("[ok] Day timeframe: statistically-bounded parameter sets, unit labels, longer RRG tail, fetch-key change");

  // =====================================================================
  // 2026-09-15: complete periods only + custom Lookback/SMA
  // =====================================================================

  // ---- the month-to-date machinery is gone ----
  ["aggregateVolumeMonthToDate", "applyVolumeAggregation", "isLikelyIncompletePeriod", "incompletePeriodMessage", "mtdNoteMessage", "renderIncompleteNote"]
    .forEach((fn) => assert.strictEqual(QD[fn], undefined, `${fn} removed`));
  assert.strictEqual(QD.state.momentum.volumeMeta, undefined, "no MTD metadata kept in state");
  ["month", "week", "day"].forEach((tf) => {
    const plan = QD.volumeFetchPlan(tf, 12, new Date("2026-09-11T00:00:00Z"));
    assert.strictEqual(plan.granularity, tf, `${tf} volume is read at its own granularity`);
    assert.ok(plan.startDate < "2026-09-11");
    assert.deepStrictEqual(Object.keys(plan).sort(), ["granularity", "startDate"], "no aggregation flag any more");
  });
  console.log("[ok] month-to-date aggregation and the in-progress warnings are removed; every timeframe reads its own granularity");

  // ---- every period RPC the app made asked for complete periods ----
  assert.ok(rpcCallLog.length > 0 && rpcCallLog.every((p) => p.p_complete_only === true), "seasonal_stats always sends p_complete_only=true");
  assert.ok(periodEndClosesCallLog.length > 0 && periodEndClosesCallLog.every((c) => c.params.p_complete_only === true),
    "period_end_closes (momentum, correlation, pagination helper) always sends p_complete_only=true");
  assert.ok(periodVolumeCallLog.length > 0 && periodVolumeCallLog.every((c) => c.params.p_complete_only === true),
    "period_volume_series (table + drill-down) always sends p_complete_only=true");
  assert.ok(dataAsOfCallLog.length >= 1, "data_as_of() was fetched at boot");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.state.dataAsOf)), MOCK_DATA_AS_OF);
  console.log("[ok] seasonal_stats / period_end_closes / period_volume_series all request complete periods only");

  // ---- "data as of" note ----
  assert.strictEqual(QD.formatThaiDate("2026-09-14"), "14 ก.ย. 2026");
  assert.strictEqual(QD.formatThaiDate("bad"), null);
  assert.strictEqual(QD.formatThaiDate(null), null);
  const monthMsg = QD.dataAsOfMessage(MOCK_DATA_AS_OF, "month");
  assert.ok(monthMsg.includes("ส.ค. 2026") && monthMsg.includes("14 ก.ย. 2026") && monthMsg.includes("เดือนที่ยังไม่จบไม่นำมาคำนวณ"), monthMsg);
  const weekMsg = QD.dataAsOfMessage(MOCK_DATA_AS_OF, "week");
  assert.ok(weekMsg.includes("7 ก.ย. 2026") && weekMsg.includes("สัปดาห์ที่ยังไม่จบไม่นำมาคำนวณ"), weekMsg);
  assert.strictEqual(QD.dataAsOfMessage(MOCK_DATA_AS_OF, "day"), "ข้อมูลรายวันถึงวันที่ 14 ก.ย. 2026");
  assert.strictEqual(QD.dataAsOfMessage(null, "month"), "", "no as-of data -> no note, no throw");
  assert.strictEqual(QD.dataAsOfMessage({ as_of: "2026-09-14", last_complete_month_start: null }, "month"), "");
  const seasonalNote = window.document.getElementById("seasonalAsOfNote");
  assert.strictEqual(seasonalNote.classList.contains("hidden"), false, "Seasonality shows which month the stats stop at");
  assert.ok(seasonalNote.textContent.includes("ส.ค. 2026"));
  QD.renderMomentumLeaderboard();
  const momNote = window.document.getElementById("momAsOfNote");
  assert.strictEqual(momNote.classList.contains("hidden"), false);
  assert.ok(momNote.textContent.includes("รายเดือน"), "Momentum note follows the active timeframe");
  assert.strictEqual(window.document.getElementById("momIncompleteNote"), null, "old dry-up warning element removed");
  console.log("[ok] 'data as of' note: Thai date formatting, per-granularity text, shown on both tabs");

  // ---- glossary explains the rule instead of month-to-date ----
  const glossary2026 = window.document.getElementById("momGlossary").textContent;
  assert.ok(glossary2026.includes("ใช้เฉพาะงวดที่จบแล้ว"), "glossary explains the complete-period rule");
  assert.ok(!glossary2026.includes("month-to-date"), "month-to-date wording removed");
  ["Volume Z-score", "RVOL", "อันดับ Momentum", "log"].forEach((k) => assert.ok(glossary2026.includes(k), `glossary still explains "${k}"`));
  console.log("[ok] glossary: complete-period rule replaces the month-to-date entry");

  // ---- custom Lookback/SMA: pure validation ----
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.momentumParamBounds("lookback", "day"))), { min: 3, max: 2520 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.momentumParamBounds("sma", "week"))), { min: 2, max: 520 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(QD.momentumParamBounds("lookback", "month"))), { min: 3, max: 120 });
  const v = (k, tf, raw) => JSON.parse(JSON.stringify(QD.validateMomentumParam(k, tf, raw)));
  assert.deepStrictEqual(v("lookback", "day", "45"), { ok: true, value: 45, error: "" });
  assert.deepStrictEqual(v("lookback", "day", " 45 "), { ok: true, value: 45, error: "" }, "surrounding spaces tolerated");
  assert.strictEqual(v("lookback", "day", "3").ok, true, "lower bound inclusive");
  assert.strictEqual(v("lookback", "day", "2520").ok, true, "upper bound inclusive");
  assert.strictEqual(v("lookback", "day", "2").ok, false);
  assert.ok(v("lookback", "day", "2").error.includes("3-2520 วัน"));
  assert.strictEqual(v("lookback", "day", "2521").ok, false);
  assert.strictEqual(v("sma", "day", "2").ok, true, "SMA may go down to 2");
  assert.strictEqual(v("sma", "day", "1").ok, false);
  assert.strictEqual(v("lookback", "month", "121").ok, false, "month cap = 10 years");
  assert.ok(v("lookback", "month", "121").error.includes("เดือน"));
  ["", "abc", "12.5", "-5", "1e2", "0"].forEach((bad) => assert.strictEqual(v("lookback", "week", bad).ok, false, `rejects ${JSON.stringify(bad)}`));
  assert.strictEqual(v("lookback", "week", null).ok, false);
  assert.ok(v("sma", "week", "x").error.startsWith("SMA"), "error names the field");
  assert.ok(QD.momentumReversalWarning("day", 10).includes("short-term reversal"), "Day lookback < 21 is flagged");
  assert.strictEqual(QD.momentumReversalWarning("day", 21), "", "21 days is not flagged");
  assert.strictEqual(QD.momentumReversalWarning("week", 4), "", "only Day is flagged");
  console.log("[ok] custom Lookback/SMA validation: integer-only, per-timeframe bounds, reversal-zone warning on Day");

  // ---- custom Lookback/SMA: DOM flow ----
  const lbSel = window.document.getElementById("momLookbackPicker");
  const lbBox = window.document.getElementById("momLookbackCustom");
  const smaSel = window.document.getElementById("momSmaPicker");
  const smaBox = window.document.getElementById("momSmaCustom");
  const errBox = window.document.getElementById("momParamError");
  const warnBox = window.document.getElementById("momParamWarning");
  const change = (el) => el.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.strictEqual(QD.state.momentum.timeframe, "month");
  assert.deepStrictEqual(Array.from(lbSel.options).map((o) => o.value), ["3", "6", "12", "custom"], "presets unchanged + a custom entry at the end");
  assert.strictEqual(lbSel.value, "12", "default preset still selected");
  assert.strictEqual(lbBox.classList.contains("hidden"), true, "number box hidden while a preset is chosen");
  assert.deepStrictEqual(Array.from(smaSel.options).map((o) => o.value), ["6", "8", "10", "12", "custom"]);

  // choosing "custom" only reveals the box -- no state change, no fetch
  const fetchesBeforeCustom = periodEndClosesCallLog.length;
  lbSel.value = "custom";
  change(lbSel);
  await flush();
  assert.strictEqual(lbBox.classList.contains("hidden"), false, "box revealed");
  assert.strictEqual(lbBox.value, "12", "pre-filled with the current value");
  assert.strictEqual(lbBox.getAttribute("max"), "120");
  assert.strictEqual(QD.state.momentum.lookbackPeriods, 12);
  assert.strictEqual(periodEndClosesCallLog.length, fetchesBeforeCustom);

  // invalid input: error shown, state untouched
  lbBox.value = "500";
  change(lbBox);
  await flush();
  assert.strictEqual(QD.state.momentum.lookbackPeriods, 12, "out-of-range value is not applied");
  assert.strictEqual(errBox.classList.contains("hidden"), false);
  assert.ok(errBox.textContent.includes("3-120 เดือน"));

  // valid input shorter than loaded history: pure recompute, no fetch
  QD.state.momentum.loadedPricePeriods = 1000; // pretend plenty is loaded
  lbBox.value = "4";
  change(lbBox);
  await flush();
  assert.strictEqual(QD.state.momentum.lookbackPeriods, 4);
  assert.strictEqual(errBox.classList.contains("hidden"), true, "error cleared once a valid value is applied");
  assert.strictEqual(periodEndClosesCallLog.length, fetchesBeforeCustom, "enough history loaded -> no fetch");
  const efaAt4 = QD.state.momentum.rows.find((r) => r.ticker === "EFA");
  assert.ok(Math.abs(efaAt4.trailingReturnPct - (150 / 130 - 1) * 100) < 1e-9, "table recomputed with lookback 4 (P2 -> P6)");
  QD.renderMomentumLookbackSmaPickers();
  assert.strictEqual(lbSel.value, "custom", "a non-preset value keeps the dropdown on 'custom' after re-render");
  assert.strictEqual(lbBox.value, "4");

  // valid input LONGER than loaded history: re-fetch, selection kept
  QD.state.momentum.loadedPricePeriods = QD.momentumPriceLookbackPeriods();
  QD.state.momentum.selectedIds = [1, 10]; // user un-ticked EEM earlier in the session
  const rrgSelBefore = QD.state.momentum.rrgSelectedIds.slice();
  const fetchesBeforeLong = periodEndClosesCallLog.length;
  lbBox.value = "60";
  change(lbBox);
  await flush(8);
  assert.strictEqual(QD.state.momentum.lookbackPeriods, 60);
  assert.ok(periodEndClosesCallLog.length > fetchesBeforeLong, "longer window than loaded -> history re-fetched");
  const longFetch = periodEndClosesCallLog[periodEndClosesCallLog.length - 1].params;
  assert.strictEqual(longFetch.p_granularity, "month");
  assert.strictEqual(longFetch.p_complete_only, true);
  assert.strictEqual(QD.state.momentum.loadedPricePeriods, 60 + QD.state.momentum.tailLength + 5, "bookkeeping updated");
  assert.deepStrictEqual(QD.state.momentum.selectedIds.slice().sort(), [1, 10], "instrument selection survives a history-only re-fetch");
  assert.deepStrictEqual(QD.state.momentum.rrgSelectedIds, rrgSelBefore, "RRG selection survives too");
  assert.strictEqual(QD.momentumNeedsFetch(), false);
  const efaAt60 = QD.state.momentum.rows.find((r) => r.ticker === "EFA");
  assert.strictEqual(efaAt60.trailingReturnPct, null, "the mock has only 7 periods, so a 60-period return is honestly empty");
  QD.state.momentum.selectedIds = [1, 10, 11];

  // SMA custom works the same way and the preset path still applies directly
  smaSel.value = "custom";
  change(smaSel);
  smaBox.value = "3";
  change(smaBox);
  await flush(6);
  assert.strictEqual(QD.state.momentum.smaPeriods, 3);
  smaSel.value = "10";
  change(smaSel);
  await flush(6);
  assert.strictEqual(QD.state.momentum.smaPeriods, 10, "choosing a preset again applies it");
  assert.strictEqual(smaBox.classList.contains("hidden"), true, "and hides the box");

  // runMomentumCalculate also re-fetches when a longer tail needs more history
  QD.state.momentum.lookbackPeriods = 2;
  QD.state.momentum.smaPeriods = 2;
  QD.state.momentum.loadedPricePeriods = QD.momentumPriceLookbackPeriods();
  QD.state.momentum.tailLength = QD.state.momentum.tailLength + 50;
  assert.strictEqual(QD.momentumNeedsFetch(), true, "a longer RRG tail needs more history than was loaded");
  const fetchesBeforeTail = periodEndClosesCallLog.length;
  await QD.runMomentumCalculate();
  await flush(6);
  assert.ok(periodEndClosesCallLog.length > fetchesBeforeTail, "คำนวณ re-fetches in that case");
  QD.state.momentum.tailLength = QD.state.momentum.tailLength - 50;

  // Day timeframe: warning for < 21, cleared by the timeframe reset
  tfEl.value = "day";
  change(tfEl);
  assert.strictEqual(QD.state.momentum.lookbackPeriods, 63, "timeframe change resets to that timeframe's default");
  assert.strictEqual(lbBox.classList.contains("hidden"), true, "and back to the preset dropdown");
  assert.strictEqual(errBox.classList.contains("hidden"), true, "stale errors cleared on timeframe change");
  QD.state.momentum.loadedPricePeriods = 100000; QD.state.momentum.dataLoaded = false; // keep this flow offline
  lbSel.value = "custom";
  change(lbSel);
  assert.strictEqual(lbBox.getAttribute("max"), "2520");
  lbBox.value = "10";
  change(lbBox);
  await flush();
  assert.strictEqual(QD.state.momentum.lookbackPeriods, 10, "short Day lookback is allowed...");
  assert.strictEqual(warnBox.classList.contains("hidden"), false, "...but flagged");
  assert.ok(warnBox.textContent.includes("21"));
  lbBox.value = "21";
  change(lbBox);
  await flush();
  assert.strictEqual(warnBox.classList.contains("hidden"), true, "warning goes away at 21");
  tfEl.value = "month";
  change(tfEl);
  QD.state.momentum.dataLoaded = true;
  console.log("[ok] custom Lookback/SMA DOM flow: reveal box, reject bad input, recompute or re-fetch as needed, selections kept, Day warning");

  // ---- the Volume tab is gone; 2 tabs remain ----
  assert.strictEqual(window.document.getElementById("tabVolume"), null, "Volume tab removed");
  assert.strictEqual(window.document.getElementById("tabBtnVolume"), null);
  assert.strictEqual(window.document.getElementById("volMetricPicker"), null, "the redundant metric picker is gone");
  // 2026-09-21: Data Health is the 3rd tab · 2026-09-22 (round 2): Events is the 4th
  assert.strictEqual(window.document.querySelectorAll("nav .qd-tab-btn").length, 4, "Seasonality + Momentum & Rotation + Data Health + Events");
  console.log("[ok] Volume tab folded into Momentum & Rotation -- no duplicated controls left behind (4 tabs incl. Data Health + Events)");

  // =====================================================================
  const plain = (x) => JSON.parse(JSON.stringify(x));
  // 2026-09-21 Round 1: market events on the drill-down chart
  // =====================================================================
  assert.strictEqual(QD.eventPeriodKey("2026-09-16", "day"), "2026-09-16");
  assert.strictEqual(QD.eventPeriodKey("2026-09-16", "week"), "2026-09-14", "Wednesday -> its Monday");
  assert.strictEqual(QD.eventPeriodKey("2026-09-14", "week"), "2026-09-14", "Monday -> itself");
  assert.strictEqual(QD.eventPeriodKey("2026-09-20", "week"), "2026-09-14", "Sunday belongs to the Monday-based week before");
  assert.strictEqual(QD.eventPeriodKey("2026-09-16", "month"), "2026-09");
  assert.strictEqual(QD.eventPeriodKey(null, "day"), null);
  const evs = [
    { event_type: "fomc", event_date: "2026-09-16", market_date: "2026-09-16", name_th: "FOMC" },
    { event_type: "cpi", event_date: "2026-09-13", market_date: "2026-09-14", name_th: "CPI" },   // Sunday event -> Monday
    { event_type: "cpi", event_date: "2026-09-11", market_date: "2026-09-11", name_th: "CPI" },
    { event_type: "fomc", event_date: "2026-08-20", market_date: "2026-08-20", name_th: "FOMC" },  // before the plotted weeks
    { event_type: "opex_monthly", event_date: "2026-09-18", market_date: "2026-09-18", name_th: "OpEx" }, // type not enabled
    { event_type: "fomc", event_date: "1990-01-01", market_date: null, name_th: "FOMC" }           // no trading day
  ];
  const weekEnds = ["2026-09-04", "2026-09-11", "2026-09-18"];
  const mappedW = QD.mapEventsToPeriods(weekEnds, evs, "week", ["fomc", "cpi"]);
  assert.deepStrictEqual(plain(mappedW.map((m) => [m.index, m.events.map((e) => e.code)])), [[1, ["cpi"]], [2, ["fomc", "cpi"]]],
    "each event lands on the week holding its trading day; out-of-range / disabled / undated events dropped");
  const mappedD = QD.mapEventsToPeriods(["2026-09-14", "2026-09-15", "2026-09-16"], evs, "day", ["fomc", "cpi"]);
  assert.deepStrictEqual(plain(mappedD.map((m) => m.index)), [0, 2], "day timeframe: exact trading day only (Sunday CPI shown on Monday)");
  const mappedM = QD.mapEventsToPeriods(["2026-08-31", "2026-09-30"], evs, "month", ["fomc", "cpi", "opex_monthly"]);
  assert.deepStrictEqual(plain(mappedM.map((m) => [m.index, m.events.length])), [[0, 1], [1, 4]]);
  const markers = QD.buildEventMarkers(mappedW);
  assert.deepStrictEqual(plain(markers.map((m) => m.label)), ["CPI", "FOMC·CPI"], "one marker per bar, types joined");
  assert.strictEqual(markers[1].color, QD.EVENT_TYPE_STYLE.fomc.color, "marker colour = first type on the bar");
  assert.strictEqual(QD.mapEventsToPeriods(weekEnds, evs, "week", []).length, 0, "nothing enabled -> no markers");

  // drawing: recording fake canvas context
  const ops = [];
  const fakeCtx = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() { ops.push(["stroke"]); },
    moveTo(x, y) { ops.push(["moveTo", x, y]); }, lineTo(x, y) { ops.push(["lineTo", x, y]); },
    fillText(t, x, y) { ops.push(["fillText", t, x, y]); }, measureText(t) { return { width: t.length * 6 }; }
  };
  const area = { left: 50, right: 500, top: 10, bottom: 300 };
  const drawn = QD.drawEventMarkers(fakeCtx, area, (i) => [40, 100, 104, 600][i],
    [{ index: 0, label: "A", color: "#000" }, { index: 1, label: "FOMC", color: "#111" }, { index: 2, label: "CPI", color: "#222" }, { index: 3, label: "Z", color: "#333" }]);
  assert.strictEqual(drawn, 2, "markers left/right of the plot area are skipped");
  assert.deepStrictEqual(plain(ops.filter((o) => o[0] === "moveTo")), [["moveTo", 100, 10], ["moveTo", 104, 10]], "vertical line from top of the plot area");
  assert.deepStrictEqual(plain(ops.filter((o) => o[0] === "lineTo")), [["lineTo", 100, 300], ["lineTo", 104, 300]], "... to the bottom");
  const texts = ops.filter((o) => o[0] === "fillText");
  assert.deepStrictEqual(plain(texts.map((t) => t[1])), ["FOMC", "CPI"]);
  assert.notStrictEqual(texts[0][3], texts[1][3], "labels that would overlap go on alternate rows");
  assert.strictEqual(QD.drawEventMarkers(fakeCtx, area, () => 100, []), 0);
  console.log("[ok] events: period keys, mapping onto day/week/month bars, one combined marker per bar, drawing within the plot area");

  // loaded once through the RPC on the first drill-down; defaults follow show_default
  assert.ok(QD.state.events.loaded, "events were loaded when the drill-down opened");
  assert.strictEqual(marketEventsCallLog.length, 1, "exactly one market_events_between call so far");
  assert.deepStrictEqual(plain(QD.state.events.types.map((t) => t.code)), ["fomc", "cpi", "us_election_mid"], "types in style-table order");
  assert.deepStrictEqual(plain(QD.state.events.enabled), ["fomc", "us_election_mid"], "on by default: types with show_default");
  const toggleBoxes = window.document.querySelectorAll("#momEventToggles input[data-event-code]");
  assert.strictEqual(toggleBoxes.length, 3);
  const cpiBox = window.document.querySelector('#momEventToggles input[data-event-code="cpi"]');
  assert.strictEqual(cpiBox.checked, false);
  const rpcBeforeToggle = marketEventsCallLog.length + periodVolumeCallLog.length;
  cpiBox.checked = true;
  change(cpiBox);
  assert.deepStrictEqual(plain(QD.state.events.enabled), ["fomc", "cpi", "us_election_mid"]);
  assert.strictEqual(marketEventsCallLog.length + periodVolumeCallLog.length, rpcBeforeToggle, "toggling redraws only, no fetch");
  assert.ok(Array.isArray(QD.state.momentum.drilldownEventMarkers), "drill-down recomputed its markers");
  await QD.ensureMarketEvents();
  assert.strictEqual(marketEventsCallLog.length, 1, "cached for the session");
  console.log("[ok] events: loaded once on first drill-down, defaults from show_default, toggles redraw without fetching");

  // failure is non-fatal
  const savedEvents = QD.state.events;
  QD.state.events = { loaded: false, loading: null, rows: [], types: [], enabled: [], enabledInitialized: false, error: "" };
  mockFailures.events = true;
  await QD.ensureMarketEvents();
  mockFailures.events = false;
  assert.strictEqual(QD.state.events.loaded, true);
  assert.deepStrictEqual(plain(QD.state.events.rows), []);
  assert.ok(/โหลดปฏิทิน event ไม่สำเร็จ: permission denied/.test(window.document.getElementById("momEventToggles").textContent));
  QD.renderMomDrilldown(); // must not throw without events
  QD.state.events = savedEvents;
  QD.renderEventToggles();
  console.log("[ok] events: a failed load shows a note and the chart still draws");

  // =====================================================================
  // 2026-09-21 Round 1: Data Health tab
  // =====================================================================
  assert.deepStrictEqual(plain(QD.classifyInstrumentHealth(MOCK_HEALTH.instruments[0])), { status: "ok", reasons: [] });
  const bad = QD.classifyInstrumentHealth(MOCK_HEALTH.instruments[1]);
  assert.strictEqual(bad.status, "error");
  assert.deepStrictEqual(plain(bad.reasons), ["ดึงข้อมูลล้มเหลว 4 วันติด", "ช้ากว่าตลาด 6 วันทำการ"]);
  assert.strictEqual(QD.classifyInstrumentHealth(MOCK_HEALTH.instruments[2]).status, "warn", "missing days in the last year -> watch");
  assert.strictEqual(QD.classifyInstrumentHealth({ rows: 10, days_behind: 2, missing_1y: 0, error_streak: 0, last_status: "ok" }).status, "warn");
  assert.strictEqual(QD.classifyInstrumentHealth({ rows: 10, days_behind: 3, missing_1y: 0, error_streak: 0, last_status: "ok" }).status, "error", "3 trading days behind = same threshold as the cron e-mail");
  assert.strictEqual(QD.classifyInstrumentHealth({ rows: 10, days_behind: 0, missing_1y: 0, error_streak: 2, last_status: "error" }).status, "warn");
  assert.strictEqual(QD.classifyInstrumentHealth({ rows: 10, days_behind: 0, missing_1y: 0, error_streak: 3, last_status: "error" }).status, "error");
  assert.strictEqual(QD.classifyInstrumentHealth({ rows: 0 }).status, "error");
  assert.strictEqual(QD.HEALTH_ERROR_DAYS, 3); assert.strictEqual(QD.HEALTH_STALE_DAYS, 3);
  const cpiH = QD.classifyMacroHealth(MOCK_HEALTH.macro[0], "2026-09-21");
  assert.strictEqual(cpiH.status, "warn"); assert.strictEqual(cpiH.age, 82);
  assert.strictEqual(QD.classifyMacroHealth(MOCK_HEALTH.macro[1], "2026-09-21").status, "ok");
  assert.strictEqual(QD.classifyMacroHealth({ series_id: "DGS10", last_date: "2026-09-10" }, "2026-09-21").status, "warn", "daily series older than 7 days");
  assert.strictEqual(QD.classifyMacroHealth({ series_id: "X", last_date: null }, "2026-09-21").status, "error");
  assert.strictEqual(QD.classifyEventTypeHealth(MOCK_HEALTH.events[0]).status, "ok");
  assert.strictEqual(QD.classifyEventTypeHealth(MOCK_HEALTH.events[1]).status, "warn");
  assert.strictEqual(QD.classifyEventTypeHealth({ count: 5, next_date: null, source: "fred" }).status, "warn");
  assert.deepStrictEqual(plain(QD.summarizeHealth(MOCK_HEALTH.instruments)), { total: 4, ok: 2, warn: 1, error: 1 });
  assert.deepStrictEqual(plain(QD.sortHealthRows(MOCK_HEALTH.instruments).map((r) => r.ticker)), ["BADX", "GAPY", "AAAA", "SPY"], "problems first, then ticker");
  assert.strictEqual(QD.escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  console.log("[ok] data health: status rules (same 3/3 thresholds as the cron alert), macro age allowance, event coverage, ordering");

  assert.strictEqual(dataHealthCallLog.length, 0, "nothing fetched before the tab is opened");
  QD.switchTab("health");
  await flush(); await flush();
  assert.strictEqual(dataHealthCallLog.length, 1, "opening the tab fetches once");
  assert.strictEqual(window.document.getElementById("tabHealth").classList.contains("hidden"), false);
  assert.strictEqual(window.document.getElementById("tabMomentum").classList.contains("hidden"), true);
  const summaryText = window.document.getElementById("healthSummary").textContent;
  assert.ok(/ทั้งหมด4/.test(summaryText) && /ปกติ2/.test(summaryText) && /ต้องจับตา1/.test(summaryText) && /มีปัญหา1/.test(summaryText), summaryText);
  const hRows = window.document.querySelectorAll("#healthInstrumentTable tbody tr");
  assert.deepStrictEqual(plain(Array.from(hRows).map((r) => r.getAttribute("data-health-ticker"))), ["BADX", "GAPY", "AAAA", "SPY"]);
  assert.strictEqual(window.document.querySelector("#healthInstrumentTable script"), null, "fetch_log text is escaped, never injected");
  assert.strictEqual(window.document.querySelector("#healthInstrumentTable b"), null);
  assert.strictEqual(window.__pwned, undefined);
  assert.ok(/18 ก.ย. 2026/.test(window.document.getElementById("healthAsOf").textContent));
  const only = window.document.getElementById("healthOnlyProblems");
  only.checked = true; change(only);
  assert.strictEqual(window.document.querySelectorAll("#healthInstrumentTable tbody tr").length, 2, "only-problems filter");
  only.checked = false; change(only);
  const macroText = window.document.getElementById("healthMacroTable").textContent;
  assert.ok(/CPIAUCSL/.test(macroText) && /ต้องจับตา/.test(macroText) && /เกณฑ์ 70 วัน/.test(macroText), macroText);
  const evText = window.document.getElementById("healthEventTable").textContent;
  assert.ok(/ประชุม FOMC/.test(evText) && /28 ต.ค. 2026/.test(evText) && /รอ workflow ดึงครั้งแรก/.test(evText), evText);
  QD.switchTab("seasonality"); QD.switchTab("health");
  await flush();
  assert.strictEqual(dataHealthCallLog.length, 1, "revisiting the tab does not refetch");
  window.document.getElementById("healthRefreshBtn").click();
  await flush(); await flush();
  assert.strictEqual(dataHealthCallLog.length, 2, "the refresh button refetches");
  mockFailures.health = true;
  await QD.loadDataHealth();
  mockFailures.health = false;
  assert.ok(/โหลด Data Health ไม่สำเร็จ: timeout/.test(window.document.getElementById("healthError").textContent));
  assert.strictEqual(window.document.querySelectorAll("#healthInstrumentTable tbody tr").length, 4, "last good data stays on screen");
  console.log("[ok] data health tab: lazy load, summary cards, problems-first table, escaped messages, filter, macro/event tables, refresh, error kept non-destructive");

  // ---- switching back to Seasonality does not reload or disturb its own state ----
  QD.switchTab("seasonality");
  assert.strictEqual(window.document.getElementById("tabSeasonality").classList.contains("hidden"), false);
  assert.strictEqual(window.document.getElementById("tabMomentum").classList.contains("hidden"), true);
  assert.strictEqual(QD.state.overviewRows.length, 12, "Seasonal tab's own state untouched by Momentum tab usage");
  console.log("[ok] switchTab back to Seasonality restores its view without disturbing Seasonal state");

  // ---- logout ----
  await QD.logout();
  await flush();
  assert.strictEqual(window.document.getElementById("authScreen").classList.contains("hidden"), false);
  assert.strictEqual(window.document.getElementById("dashboardScreen").classList.contains("hidden"), true);
  console.log("[ok] logout returns to login screen");

  console.log("\nALL TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
