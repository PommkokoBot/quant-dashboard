// Event Study engine checked against REAL SPY data (re-created 2026-10-30).
// Every expected value below was computed independently in Postgres with window
// functions and percentile_cont — not by this code — so the two implementations
// have to agree for the test to pass.
//
//   with px as (select date, round(coalesce(adj_close,close)::numeric,2) c,
//                      row_number() over (order by date) rn
//               from ohlcv_daily o join instruments i on i.id=o.instrument_id
//               where i.ticker='SPY' and date between '2026-01-02' and '2026-09-25'),
//        ev as (select event_date from market_events where event_type='fomc'
//               and event_date between '2026-01-02' and '2026-09-25'),
//        anc as (select (select max(rn) from px where px.date<=e.event_date) rn0 from ev e),
//        k as (select generate_series(-5,5) k)
//   select k.k, count(*), avg(...), percentile_cont(0.5|0.25) within group (...), min, max
//   from k join anc a on true join px b on b.rn=a.rn0 join px p on p.rn=a.rn0+k.k
//   group by k.k order by k.k;
//
// Usage: QD_HTML=<index.html> node tests/test_event_study_real.js

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.resolve(__dirname, process.env.QD_HTML || "../index.html"), "utf8")
  .replace(/<script[^>]*src=[^>]*><\/script>/g, "");
const QD = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/", beforeParse(w) { w.__QD_TEST__ = true; } }).window.QD;

// SPY closes, 2026-01-02 → 2026-09-25, rounded to 2 decimals exactly as the query above rounds them
const DATES = "20260102,20260105,20260106,20260107,20260108,20260109,20260112,20260113,20260114,20260115,20260116,20260120,20260121,20260122,20260123,20260126,20260127,20260128,20260129,20260130,20260202,20260203,20260204,20260205,20260206,20260209,20260210,20260211,20260212,20260213,20260217,20260218,20260219,20260220,20260223,20260224,20260225,20260226,20260227,20260302,20260303,20260304,20260305,20260306,20260309,20260310,20260311,20260312,20260313,20260316,20260317,20260318,20260319,20260320,20260323,20260324,20260325,20260326,20260327,20260330,20260331,20260401,20260402,20260406,20260407,20260408,20260409,20260410,20260413,20260414,20260415,20260416,20260417,20260420,20260421,20260422,20260423,20260424,20260427,20260428,20260429,20260430,20260501,20260504,20260505,20260506,20260507,20260508,20260511,20260512,20260513,20260514,20260515,20260518,20260519,20260520,20260521,20260522,20260526,20260527,20260528,20260529,20260601,20260602,20260603,20260604,20260605,20260608,20260609,20260610,20260611,20260612,20260615,20260616,20260617,20260618,20260622,20260623,20260624,20260625,20260626,20260629,20260630,20260701,20260702,20260706,20260707,20260708,20260709,20260710,20260713,20260714,20260715,20260716,20260717,20260720,20260721,20260722,20260723,20260724,20260727,20260728,20260729,20260730,20260731,20260803,20260804,20260805,20260806,20260807,20260810,20260811,20260812,20260813,20260814,20260817,20260818,20260819,20260820,20260821,20260824,20260825,20260826,20260827,20260828,20260831,20260901,20260902,20260903,20260904,20260908,20260909,20260910,20260911,20260914,20260915,20260916,20260917,20260918,20260921,20260922,20260923,20260924,20260925".split(",");
const CLOSES = "677.88,682.39,686.45,684.24,684.17,688.69,689.77,688.39,685.01,686.88,686.30,672.33,680.09,683.64,683.89,687.36,690.10,690.03,688.66,686.61,690.02,684.19,680.87,672.37,685.27,688.57,686.76,686.60,675.99,676.47,677.56,680.97,679.18,684.09,677.10,682.02,687.78,683.96,680.67,681.06,675.06,679.82,676.03,667.17,673.01,671.93,671.09,660.90,657.16,663.84,665.59,656.30,654.69,645.30,652.08,649.89,653.51,641.84,630.89,628.78,647.06,651.94,652.52,655.61,655.90,672.60,676.48,676.04,682.64,690.96,696.41,698.12,706.56,705.15,700.53,707.63,704.88,710.34,711.57,708.10,707.99,715.04,717.02,714.39,720.12,730.13,727.89,733.90,735.57,734.46,738.57,744.40,735.44,734.93,730.03,737.51,738.98,741.88,746.81,746.68,750.80,752.67,754.72,755.74,750.44,753.27,733.83,735.49,733.34,721.77,734.04,738.01,751.03,746.55,737.23,744.89,742.55,731.76,731.42,732.48,727.18,739.16,744.92,743.91,742.94,749.42,745.86,743.55,749.85,753.08,747.31,749.97,752.94,748.86,741.45,740.25,746.43,745.56,736.35,737.10,737.26,739.02,727.65,739.85,745.18,755.79,769.42,767.88,766.66,771.34,771.12,768.65,770.58,775.95,774.42,770.76,765.55,767.15,760.71,763.82,761.58,764.01,764.18,769.19,767.44,765.15,759.89,763.26,771.25,768.28,764.06,760.51,755.95,762.40,759.00,755.51,752.18,760.71,761.69,773.50,773.38,767.81,767.18,771.35".split(",").map(Number);
// the real FOMC meeting dates in that window, from market_events
const FOMC = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16"];

// what Postgres says the answer is: offset -> [n, mean, median, p25, min, max]
const SQL = {
  "-5": [6, 0.372322, 0.528300, -1.093100, -2.097039, 2.461348],
  "-4": [6, 0.099953, 0.034255, -0.437629, -0.926047, 1.195630],
  "-3": [6, 0.389394, 0.231482, 0.112110, -0.889816, 1.358717],
  "-2": [6, 0.894474, 1.027781, 0.605917, -0.386940, 1.871872],
  "-1": [6, 0.785110, 0.853452, 0.122331, 0.010144, 1.562564],
  "0":  [6, 0, 0, 0, 0, 0],
  "1":  [6, 0.733602, 1.017401, 0.100038, -0.245315, 1.676630],
  "2":  [6, 0.583136, 0.992973, -0.191318, -1.676063, 2.409125],
  "3":  [6, 1.036537, 0.451259, -0.482611, -0.741967, 3.867244],
  "4":  [6, 1.276843, 0.462608, -0.831776, -0.976687, 5.740397],
  "5":  [6, 1.389498, 0.826425, -0.589505, -1.327479, 5.528757]
};

const iso = (s) => s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
const px = QD.buildPriceIndex(DATES.map((d, i) => ({ date: iso(d), close: CLOSES[i] })));

function main() {
  assert.strictEqual(px.dates.length, 184, "184 real SPY bars loaded");
  assert.strictEqual(CLOSES.length, 184, "every bar has a close");
  const res = QD.computeEventStudy(px, FOMC.map((d) => ({ start: d })), { kind: "point", n: 5 });
  assert.strictEqual(res.nEvents, 6, "all six 2026 FOMC meetings are usable");

  let worst = 0;
  Object.keys(SQL).forEach((k) => {
    const i = res.labels.indexOf(k === "0" ? "วันเกิดเหตุ" : (+k > 0 ? "+" + k : k));
    assert.ok(i >= 0, "column " + k + " exists");
    const [n, mean, med, p25, mn, mx] = SQL[k];
    assert.strictEqual(res.nAt[i], n, "n at " + k);
    [[res.mean[i], mean, "mean"], [res.med[i], med, "median"], [res.p25[i], p25, "p25"],
     [res.min[i], mn, "min"], [res.max[i], mx, "max"]].forEach(([got, want, what]) => {
      const d = Math.abs(got - want);
      worst = Math.max(worst, d);
      assert.ok(d < 5e-6, `${what} at ${k}: engine ${got} vs Postgres ${want}`);
    });
  });
  console.log(`[ok] real SPY 2026 + 6 real FOMC dates: 55 values match Postgres (worst difference ${worst.toExponential(2)})`);

  assert.strictEqual(res.gap.med, 34, "2026 FOMC meetings sit ~34 trading days apart");
  assert.strictEqual(res.cap, 33, "cap = median gap - 1");
  assert.ok(res.gap.min >= 20 && res.gap.max <= 45, "the gap range is plausible for eight meetings a year");

  const at5 = res.labels.indexOf("+5");
  assert.strictEqual(res.baseline[res.labels.indexOf("วันเกิดเหตุ")], 0, "the baseline is 0 at day 0");
  assert.ok(res.baseline[at5] > res.min[at5] && res.baseline[at5] < res.max[at5],
    "the baseline (average of every 11-day window in the same series) sits inside what the market actually did");
  console.log(`[ok] real data: FOMC cadence ${res.gap.med} trading days -> cap ±${res.cap} · baseline at +5 = ${res.baseline[at5].toFixed(3)} % vs event median ${res.med[at5].toFixed(3)} %`);

  console.log("\nALL REAL-DATA EVENT STUDY TESTS PASSED");
}
main();
