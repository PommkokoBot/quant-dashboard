#!/usr/bin/env node
/**
 * Pins the NUMBERS the RRG engine produces.
 *
 * Why this file exists (2026-11-23): until today nothing called
 * computeRotationGraphData directly and asserted its output. The suite
 * exercised it only through what reads it afterwards (quadrantMapFromRotation,
 * the scatter grouping), so every one of RS-Ratio, RS-Momentum, the EMA seed
 * and the SMA null rule could change value without a single test going red.
 *
 * What this file DOES prove:
 *   - the engine still returns the same numbers it returns today, to 1e-9
 *   - the null rules of ema() and sma() behave as written, pinned on their own
 *   - a gap in a series removes points instead of interpolating across it
 *
 * What it does NOT prove: that those numbers are the right ones. They are
 * golden values captured from the pushed app.js, not independently derived.
 * Their job is backward compatibility and, when the formula is moved into SQL,
 * a target to compare against -- the 2026-11-04 round could check 2,697
 * JS<->SQL pairs only because the JS side was pinned first. This is that pin
 * for the rotation side.
 *
 * Proved red-able by tests/mutate_rotation.js.
 *
 *   node tests/test_rotation.js
 */
const assert = require("assert");
const { loadPage } = require("./_page.js");

const QD = loadPage().window.QD;
assert.ok(QD, "the page must expose window.QD");

// ---------------------------------------------------------------------------
// Fixture: 20 monthly period ends, no randomness anywhere.
//   bench = 100, 101, 102, ...        (linear)
//   AAA   = bench * (1 + 0.01*i)      relative strength rising
//   BBB   = bench * 2 exactly         rs constant -> lands on (100, 100)
//   CCC   = one point                 too little history for any rotation
//   DDD   = AAA with three periods missing in the middle
// ---------------------------------------------------------------------------
const AXIS = ["2025-01-31","2025-02-28","2025-03-31","2025-04-30","2025-05-31",
  "2025-06-30","2025-07-31","2025-08-31","2025-09-30","2025-10-31","2025-11-30",
  "2025-12-31","2026-01-31","2026-02-28","2026-03-31","2026-04-30","2026-05-31",
  "2026-06-30","2026-07-31","2026-08-31"];

const bench = AXIS.map((d, i) => ({ period_end: d, adj_close: 100 + i }));
const A = AXIS.map((d, i) => ({ period_end: d, adj_close: (100 + i) * (1 + 0.01 * i) }));
const B = AXIS.map((d, i) => ({ period_end: d, adj_close: (100 + i) * 2 }));
const C = [{ period_end: AXIS[0], adj_close: 100 }];
const D = A.filter((_, i) => i !== 7 && i !== 8 && i !== 9);

const INSTS = [
  { id: 1, ticker: "AAA" }, { id: 2, ticker: "BBB" },
  { id: 3, ticker: "CCC" }, { id: 4, ticker: "DDD" }
];
const SERIES = { 1: A, 2: B, 3: C, 4: D };

// Golden values captured from the pushed app.js (md5 recorded in the round log).
const GOLDEN = {
  AAA: [
    ["2025-12-31", 101.388888888889, 99.960129357822],
    ["2026-01-31", 101.376146788991, 99.960862630692],
    ["2026-02-28", 101.363636363636, 99.961579199720],
    ["2026-03-31", 101.351351351351, 99.962277937513],
    ["2026-04-30", 101.339285714286, 99.962958619694],
    ["2026-05-31", 101.327433628319, 99.963621458345],
    ["2026-06-30", 101.315789473684, 99.964266869523],
    ["2026-07-31", 101.304347826087, 99.964895357765],
    ["2026-08-31", 101.293103448276, 99.965507459036]
  ],
  BBB: [
    ["2025-12-31", 100, 100], ["2026-01-31", 100, 100], ["2026-02-28", 100, 100],
    ["2026-03-31", 100, 100], ["2026-04-30", 100, 100], ["2026-05-31", 100, 100],
    ["2026-06-30", 100, 100], ["2026-07-31", 100, 100], ["2026-08-31", 100, 100]
  ],
  CCC: [],
  DDD: [
    ["2026-07-31", 101.345159776975, 99.686184970725],
    ["2026-08-31", 101.317368577197, 99.781175352539]
  ]
};

const TOL = 1e-9;
// Arrays that come out of jsdom carry THAT realm's Array.prototype, so
// assert.deepStrictEqual fails on the prototype even when every element
// matches. The same round-trip is used in test_app.js for the same reason.
const plain = (v) => JSON.parse(JSON.stringify(v));
const byTicker = (out) => {
  const m = {};
  out.results.forEach((r) => { m[r.ticker] = r; });
  return m;
};

// ---------------------------------------------------------------------------
// 1. The numbers themselves
// ---------------------------------------------------------------------------
{
  const out = QD.computeRotationGraphData(INSTS, SERIES, bench, 4, 12);

  assert.strictEqual(out.m, 4, "m is echoed back as given");
  assert.strictEqual(out.k, 3, "k = max(2, round(0.7*m)) = 3 when m = 4");
  assert.strictEqual(out.results.length, 4, "one result per instrument, including the empty one");

  const r = byTicker(out);
  for (const ticker of Object.keys(GOLDEN)) {
    const want = GOLDEN[ticker];
    const got = r[ticker].points;
    assert.strictEqual(got.length, want.length, `${ticker}: point count`);
    for (let i = 0; i < want.length; i++) {
      assert.strictEqual(got[i].periodEnd, want[i][0], `${ticker}[${i}]: period_end`);
      assert.ok(Math.abs(got[i].x - want[i][1]) < TOL,
        `${ticker}[${i}]: RS-Ratio ${got[i].x} vs ${want[i][1]}`);
      assert.ok(Math.abs(got[i].y - want[i][2]) < TOL,
        `${ticker}[${i}]: RS-Momentum ${got[i].y} vs ${want[i][2]}`);
    }
  }
  console.log("[ok] ตัวเลข RS-Ratio / RS-Momentum ตรงค่าที่ตรึงไว้ทุกจุด (29 จุด · 4 กอง · 1e-9)");

  // A series that is exactly a multiple of the benchmark sits on both lines.
  // This is also what pins the strict ">" in classifyQuadrant: a point AT 100
  // is not above it.
  const onLine = r.BBB.points[r.BBB.points.length - 1];
  assert.strictEqual(onLine.x, 100, "a constant-ratio series gives RS-Ratio exactly 100");
  assert.strictEqual(onLine.y, 100, "...and RS-Momentum exactly 100");
  assert.strictEqual(QD.classifyQuadrant(100, 100), "Lagging",
    "a point exactly on both lines is Lagging -- the comparison is strict >");
  console.log("[ok] กองที่เป็นสัดส่วนคงที่ของดัชนีได้ (100,100) เป๊ะ และนับเป็น Lagging (เครื่องหมาย > แบบเข้ม)");

  // Too little history is an empty result, not a thrown error and not a
  // fabricated point.
  assert.deepStrictEqual(plain(r.CCC.points), [], "one price point produces no rotation point at all");
  assert.strictEqual(r.CCC.instrumentId, 3, "...but the instrument is still reported");
  console.log("[ok] ประวัติสั้นเกินคืนจุดว่าง ไม่ throw และไม่เดาจุดขึ้นมา");

  // The gap matters: DDD has the same prices as AAA where it has prices at
  // all, and still ends up with 2 points instead of 9, because sma() refuses a
  // window containing a hole rather than closing the hole.
  assert.ok(r.DDD.points.length < r.AAA.points.length,
    "a gap removes points; it is never interpolated across");
  console.log("[ok] ช่วงที่ข้อมูลขาดทำให้จุดหายไป (9 -> 2) ไม่ใช่ลากค่าข้ามรู");
}

// ---------------------------------------------------------------------------
// 2. tailLength slices, it does not recompute
// ---------------------------------------------------------------------------
{
  const full = byTicker(QD.computeRotationGraphData(INSTS, SERIES, bench, 4, 12));
  const short = byTicker(QD.computeRotationGraphData(INSTS, SERIES, bench, 4, 3));

  assert.strictEqual(short.AAA.points.length, 3, "tail 3 keeps three points");
  assert.deepStrictEqual(
    plain(short.AAA.points.map((p) => p.periodEnd)),
    plain(full.AAA.points.slice(-3).map((p) => p.periodEnd)),
    "the three kept are the LAST three, not the first three");
  assert.ok(Math.abs(short.AAA.points[2].x - full.AAA.points[8].x) < TOL,
    "the newest point carries the same value at either tail length");
  console.log("[ok] Tail length ตัดหาง ไม่ได้คำนวณใหม่ — จุดล่าสุดค่าเท่ากันทุกความยาว");

  const none = QD.computeRotationGraphData(INSTS, SERIES, [], 4, 12);
  assert.deepStrictEqual(plain(none.results), [], "no benchmark series -> no results, no throw");
  console.log("[ok] ไม่มีซีรีส์ดัชนีอ้างอิง คืนผลว่าง ไม่ throw");
}

// ---------------------------------------------------------------------------
// 3. ema() and sma() null rules, pinned on their own
//
// These two are the parts lessons.md flags as portable-wrong-in-silence:
// the EMA seeds on the mean of the first `period` non-null values and treats
// a null as "skip", not as "break the run"; the SMA returns null for any
// window that contains a null. A port that gets either one wrong produces
// numbers that look plausible everywhere.
// ---------------------------------------------------------------------------
{
  const e = QD.ema([1, 2, 3, 4, 5], 3);
  assert.deepStrictEqual(plain(e.slice(0, 2)), [null, null], "EMA has no value before the seed is full");
  assert.strictEqual(e[2], 2, "the seed is the arithmetic mean of the first 3 values");
  assert.strictEqual(e[3], 4 * 0.5 + 2 * 0.5, "then alpha = 2/(period+1) = 0.5");
  assert.strictEqual(e[4], 5 * 0.5 + e[3] * 0.5, "...and it compounds from there");

  // A hole does NOT restart the seed and does NOT leave a hole behind it.
  const eGap = QD.ema([1, 2, null, 3, 4], 3);
  assert.strictEqual(eGap[2], null, "the null position itself stays null");
  assert.strictEqual(eGap[3], 2, "the seed completes on the 3rd NON-null value, skipping the hole");
  console.log("[ok] ema: seed เป็นค่าเฉลี่ยของ period ตัวแรกที่ไม่ใช่ null · null ถูกข้าม ไม่ถือว่าขาดช่วง");

  const s = QD.sma([1, 2, 3, 4], 3);
  assert.deepStrictEqual(plain(s), [null, null, 2, 3], "SMA starts at index period-1");
  const sGap = QD.sma([1, 2, null, 4, 5, 6], 3);
  assert.deepStrictEqual(plain(sGap), [null, null, null, null, null, 5],
    "any window containing a null is null -- the hole blanks three windows, not one");
  console.log("[ok] sma: หน้าต่างที่มี null คืน null ทั้งหน้าต่าง (รูเดียวทำให้ 3 หน้าต่างว่าง)");
}

// ---------------------------------------------------------------------------
// 4. The Edge yardstick: two steps of movement, measured per axis
// ---------------------------------------------------------------------------
{
  // dx = [1, 2] -> median 1.5 -> rsEdge 3 ; dy = [0.5, 1] -> median 0.75 -> momEdge 1.5
  const walk = [
    { x: 100, y: 100, axisIndex: 0 },
    { x: 101, y: 100.5, axisIndex: 1 },
    { x: 103, y: 101.5, axisIndex: 2 }
  ];
  const scale = QD.rotationStepScale([walk]);
  assert.strictEqual(scale.rsStep, 1.5, "median |dx| over the window");
  assert.strictEqual(scale.momStep, 0.75, "median |dy| over the window");
  assert.strictEqual(scale.rsEdge, 3, "the threshold is TWO steps (มติ 32)");
  assert.strictEqual(scale.momEdge, 1.5, "...on each axis separately");
  assert.strictEqual(scale.nSteps, 2, "two consecutive pairs, so two steps");

  // A jump across a hole in the prices is not one period of movement and
  // must not enter the median -- it would be the single largest "step" there
  // is and would drag the threshold up for every fund in the run.
  const withGap = walk.concat([{ x: 130, y: 130, axisIndex: 7 }]);
  const scaleGap = QD.rotationStepScale([withGap]);
  assert.strictEqual(scaleGap.nSteps, 2, "the step across the gap is skipped");
  assert.strictEqual(scaleGap.rsEdge, scale.rsEdge, "so the threshold is unchanged");

  const empty = QD.rotationStepScale([[], [{ x: 1, y: 1, axisIndex: 0 }]]);
  assert.strictEqual(empty.nSteps, 0, "no pairs -> no steps");
  assert.strictEqual(empty.rsEdge, null, "...and no threshold, rather than a zero one");
  console.log("[ok] ก้าวกลางแยกแกน · เกณฑ์ = สองก้าว · ก้าวที่ข้ามรูไม่ถูกนับ · ไม่มีคู่ = ไม่มีเกณฑ์");
}

// ---------------------------------------------------------------------------
// 5. Core / Edge
//
// The two fixture points below, (110,100) and (100,90), are the ones
// test_app.js used to pin the deleted 8-way label with. They are kept here
// because they are the best fixture for the new rule too: both sit exactly on
// an axis, so their distance to it is 0 and they are Edge with no special
// case written for "exactly on the line" (มติ 39).
// ---------------------------------------------------------------------------
{
  const scale = { rsStep: 1.5, momStep: 0.75, rsEdge: 3, momEdge: 1.5, nSteps: 2 };

  assert.strictEqual(QD.classifyEdge(110, 100, scale), "Edge",
    "exactly on the momentum axis: distance 0, no special case needed");
  assert.strictEqual(QD.classifyEdge(100, 90, scale), "Edge",
    "exactly on the RS axis: same");
  assert.strictEqual(QD.classifyEdge(110, 110, scale), "Core",
    "clear of both axes by more than two steps");

  // The same distance is Edge on one axis and Core on the other, because the
  // axes do not move at the same speed. This is the whole reason มติ 32 keeps
  // two yardsticks instead of one.
  assert.strictEqual(QD.classifyEdge(102, 110, scale), "Edge", "2 away from the RS axis, threshold 3");
  assert.strictEqual(QD.classifyEdge(110, 102, scale), "Core", "2 away from the momentum axis, threshold 1.5");

  assert.strictEqual(QD.classifyEdge(110, 110, null), null, "no scale -> no second word, never a guessed one");
  assert.strictEqual(QD.classifyEdge(null, 110, scale), null, "no coordinates -> null");
  assert.strictEqual(QD.classifyEdge(110, NaN, scale), null, "NaN is not a position");
  console.log("[ok] Core/Edge: จุดบนเส้นเป็น Edge เอง · ไม้วัดแยกแกนจริง (ระยะ 2 เป็น Edge บนแกนหนึ่ง แต่ Core บนอีกแกน)");

  // y = 100 is NOT > 100, so a point sitting on the momentum axis to the
  // right of centre is Weakening, not Leading. Same strict rule as line 673
  // of test_app.js; getting this expectation wrong while writing the suite is
  // itself the reason the rule is pinned in two places.
  assert.strictEqual(QD.rotationStateLabel(110, 100, scale), "Weakening – Edge");
  assert.strictEqual(QD.rotationStateLabel(100, 100, scale), "Lagging – Edge",
    "the crosshair itself is Lagging (strict >) and Edge (distance 0)");
  assert.strictEqual(QD.rotationStateLabel(110, 110, null), "Leading",
    "without a scale the state is one word, not a wrong second word");
  assert.strictEqual(QD.rotationStateLabel(null, 100, scale), null);
  assert.strictEqual(QD.stateLabelOf({ zone: "Improving", edge: "Core" }), "Improving – Core",
    "stateLabelOf reads an already-tagged point and must word it identically");
  assert.strictEqual(QD.stateLabelOf({ zone: "Improving", edge: null }), "Improving");
  assert.strictEqual(QD.stateLabelOf(null), null);
  console.log("[ok] ป้ายสองคำ: โซนคำแรก Core/Edge คำที่สอง · ไม่มีเกณฑ์ = เหลือคำเดียว ไม่เดาคำที่สอง");
}

// ---------------------------------------------------------------------------
// 6. "อยู่มานาน" -- and the difference between "n" and "at least n"
// ---------------------------------------------------------------------------
{
  const run = (zones, idx) => zones.map((z, i) => ({
    x: z === "Leading" ? 110 : 90, y: z === "Leading" ? 110 : 90,
    zone: z, axisIndex: idx ? idx[i] : i
  }));

  const held = QD.zoneDwell(run(["Leading", "Leading", "Leading", "Leading", "Leading"]));
  assert.strictEqual(held.periods, 5, "the run covers the whole window");
  assert.strictEqual(held.censored, true, "...so we only know it is AT LEAST 5 periods old");

  const flipped = QD.zoneDwell(run(["Lagging", "Lagging", "Lagging", "Leading", "Leading"]));
  assert.strictEqual(flipped.periods, 2, "counted back to the flip");
  assert.strictEqual(flipped.censored, false, "the start of the run is visible, so the count is exact");

  // Across a hole we do not know what the zone was, so the count stops there
  // rather than assuming the run continued through it.
  const gapped = QD.zoneDwell(run(["Leading", "Leading", "Leading"], [0, 1, 4]));
  assert.strictEqual(gapped.periods, 1, "the gap ends the count");
  assert.strictEqual(gapped.censored, false, "and it is not reported as censored either");

  assert.strictEqual(QD.zoneDwell([]).periods, null, "no history -> no number, not 0");
  assert.strictEqual(QD.zoneDwell(undefined).periods, null, "missing history -> no number, no throw");
  console.log("[ok] อยู่มานาน: นับย้อน · แยก \"n\" กับ \"อย่างน้อย n\" · รูข้อมูลหยุดการนับ · ไม่มีข้อมูลคืน null ไม่ใช่ 0");
}

// ---------------------------------------------------------------------------
// 7. Base rates (5g): the denominator is the point
// ---------------------------------------------------------------------------
{
  assert.strictEqual(QD.ZONE_BASE_RATE_MIN_N, 30, "the floor is a named constant, not a literal in the view");

  const leadingRun = (n, from) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: 110, y: 110, zone: "Leading", axisIndex: (from || 0) + i });
    return out;
  };

  // 31 periods -> 30 transitions, exactly on the floor.
  const atFloor = QD.zoneBaseRates([leadingRun(31)]);
  const lead = atFloor.find((r) => r.zone === "Leading");
  assert.strictEqual(lead.n, 30, "n periods give n-1 transitions");
  assert.strictEqual(lead.stayed, 30, "every one of them stayed");
  assert.strictEqual(lead.pStay, 1, "at the floor the number is shown");

  // One period fewer and it is a dash -- but n is still reported, because the
  // reader has to be able to see WHY it is a dash (มติ 37).
  const belowFloor = QD.zoneBaseRates([leadingRun(30)]);
  const lead2 = belowFloor.find((r) => r.zone === "Leading");
  assert.strictEqual(lead2.n, 29, "the denominator is reported even when the rate is not");
  assert.strictEqual(lead2.pStay, null, "below the floor the rate is withheld, not rounded");

  // Every zone is always present, so a zone nobody visited reads as n = 0
  // rather than disappearing from the table.
  assert.strictEqual(atFloor.length, 4, "all four zones are always listed");
  assert.strictEqual(atFloor.find((r) => r.zone === "Lagging").n, 0, "an unvisited zone is n = 0, not absent");

  // A gap is not a transition.
  const across = leadingRun(20).concat(leadingRun(20, 40));
  const gapped = QD.zoneBaseRates([across]);
  assert.strictEqual(gapped.find((r) => r.zone === "Leading").n, 38,
    "two runs of 20 give 19 + 19 transitions, not 39 -- the jump between them is skipped");
  console.log("[ok] ฐานอัตรา: n = งวด−1 · ต่ำกว่า 30 ขึ้นขีดกลางแต่ยังโชว์ตัวหาร · ครบสี่โซนเสมอ · รูไม่นับเป็นการเปลี่ยน");
}

// ---------------------------------------------------------------------------
// 8. The strip: 24 calendar months, anchored, holes stay holes
// ---------------------------------------------------------------------------
{
  assert.strictEqual(QD.ZONE_STRIP_MONTHS, 24, "the window is 24 months for every timeframe (มติ 38)");

  const months = QD.zoneStripMonths("2026-11", 24);
  assert.strictEqual(months.length, 24);
  assert.strictEqual(months[0], "2024-12", "oldest first: 24 months ENDING at 2026-11 starts at 2024-12, i.e. 23 months back");
  assert.strictEqual(months[23], "2026-11", "newest last");
  assert.deepStrictEqual(plain(QD.zoneStripMonths("2026-01", 3)), ["2025-11", "2025-12", "2026-01"],
    "stepping back over new year is calendar arithmetic, not month-number arithmetic");
  assert.deepStrictEqual(plain(QD.zoneStripMonths("P12", 24)), [],
    "a period label that is not a date gives no strip rather than Invalid Date");
  assert.deepStrictEqual(plain(QD.zoneStripMonths("2026-13", 24)), [], "month 13 is not a month");

  // Two points inside the same month: the LAST one is the sample (มติ 38).
  const history = [
    { periodEnd: "2026-09-15", zone: "Lagging", edge: "Core" },
    { periodEnd: "2026-09-30", zone: "Leading", edge: "Edge" },
    { periodEnd: "2026-11-30", zone: "Leading", edge: "Core" }
  ];
  const strip = QD.zoneHistoryStrip(history, months);
  assert.strictEqual(strip.length, 24, "one cell per calendar month, always");
  const sep = strip.find((c) => c.ym === "2026-09");
  assert.strictEqual(sep.zone, "Leading", "the last period of the month is the sample, not the first");
  assert.strictEqual(sep.periodEnd, "2026-09-30");
  assert.strictEqual(strip.find((c) => c.ym === "2026-11").edge, "Core", "Core/Edge rides along for the tooltip");

  // The missing months stay empty IN PLACE. If the strip closed its gaps, two
  // rows would no longer line up and scanning a column downwards -- the only
  // thing the strip is for -- would be wrong.
  assert.strictEqual(strip.find((c) => c.ym === "2026-10").zone, null, "October has no period end in this fixture");
  assert.strictEqual(strip[23].ym, "2026-11", "the newest month is still in the last cell");
  assert.strictEqual(strip.filter((c) => c.zone != null).length, 2, "only the two months with data are filled");
  console.log("[ok] แถบ: 24 ช่องปฏิทินเสมอ · อ่านงวดสุดท้ายของเดือน · เดือนที่ไม่มีข้อมูลเว้นว่างอยู่ที่เดิม ไม่ชิดขวา");
}

// ---------------------------------------------------------------------------
// 9. End to end: the engine tags its own points and carries the window
// ---------------------------------------------------------------------------
{
  const out = QD.computeRotationGraphData(INSTS, SERIES, bench, 4, 12);
  assert.strictEqual(out.months.length, 24, "the run carries the 24 calendar months the strip draws on");
  assert.strictEqual(out.months[23], "2026-08", "anchored on the newest period end in the data");
  assert.ok(out.scale.nSteps > 0, "the threshold was measured from this run's own movement");

  const r = byTicker(out);
  const last = r.AAA.points[r.AAA.points.length - 1];
  assert.strictEqual(last.zone, QD.classifyQuadrant(last.x, last.y), "each point carries its own zone");
  assert.strictEqual(last.edge, QD.classifyEdge(last.x, last.y, out.scale), "...and its own Core/Edge");
  assert.ok(r.AAA.history.length >= r.AAA.points.length,
    "the window is at least as long as the tail -- the statistics never read the tail (มติ 36)");

  // Changing ONLY the tail must not move the Edge threshold: a visual control
  // that silently relabels funds is exactly what มติ 36 forbids.
  const shortTail = QD.computeRotationGraphData(INSTS, SERIES, bench, 4, 3);
  assert.strictEqual(shortTail.scale.rsEdge, out.scale.rsEdge, "tail 3 vs 12: same RS threshold");
  assert.strictEqual(shortTail.scale.momEdge, out.scale.momEdge, "...and the same momentum threshold");
  assert.strictEqual(shortTail.scale.nSteps, out.scale.nSteps, "...measured over the same number of steps");
  console.log("[ok] ครบวง: จุดพาโซน+Core/Edge มาเอง · หน้าต่าง 24 เดือนติดมากับผล · ย่อ Tail ไม่ขยับเกณฑ์ Edge");
}

// ---------------------------------------------------------------------------
// 10. The fetch has to be long enough for the strip to exist
//
// An empty strip cell is a legitimate value ("no data that month"), so a
// fetch that is too short produces a strip that is wrong in a way nothing
// complains about. These numbers are what that costs.
// ---------------------------------------------------------------------------
{
  const page = loadPage().window;
  const Q = page.QD;
  const set = (tf, look, sma) => {
    Q.state.momentum.timeframe = tf;
    Q.state.momentum.lookbackPeriods = look;
    Q.state.momentum.smaPeriods = sma;
    Q.state.momentum.tailLength = 12;
  };

  set("month", 12, 200);
  assert.strictEqual(Q.zoneStripPricePeriods(), 69, "monthly: 2m+2k warm-up (40) + 24 months + 5");
  assert.strictEqual(Q.momentumPriceLookbackPeriods(), 217,
    "monthly is UNCHANGED -- the SMA200 filter already asks for more than the strip does");

  set("week", 52, 40);
  assert.strictEqual(Q.zoneStripPricePeriods(), 286, "weekly: warm-up 176 + 105 weeks + 5");
  assert.strictEqual(Q.momentumPriceLookbackPeriods(), 286, "weekly grows from 69 to 286");

  set("day", 63, 200);
  assert.strictEqual(Q.zoneStripPricePeriods(), 723, "daily: warm-up 214 + 504 trading days + 5");
  assert.strictEqual(Q.momentumPriceLookbackPeriods(), 723, "daily grows from 217 to 723");

  // The window may only ever grow: whatever the strip needs, the charts still
  // need their own span, and the fetch must satisfy both.
  set("day", 63, 5000);
  assert.strictEqual(Q.momentumPriceLookbackPeriods(), 5017,
    "a longer SMA still wins when it asks for more than the strip");
  console.log("[ok] หน้าต่างการดึงราคา: รายเดือนไม่เปลี่ยน (217) · รายสัปดาห์ 69→286 · รายวัน 217→723 · และโตได้เท่านั้น ไม่หด");
}

// ---------------------------------------------------------------------------
// 11. The zone colours exist in two files -- pin them together
//
// The strip legend in index.html spells the four zone colours as literal hex,
// because a legend swatch cannot read a JS constant. That is a second copy of
// a rule, which is the drift family this project keeps getting bitten by, so
// the copies are compared here rather than trusted.
// ---------------------------------------------------------------------------
{
  const { readPage } = require("./_page.js");
  const html = readPage();
  const colors = QD.QUADRANT_COLORS;
  const zones = QD.QUADRANT_ORDER;
  assert.strictEqual(zones.length, 4, "four zones");
  zones.forEach((z) => {
    const hex = colors[z];
    assert.ok(hex, `${z} has a colour in app.js`);
    const swatch = new RegExp(`background:${hex};"></span>${z}`);
    assert.ok(swatch.test(html),
      `the strip legend in index.html must carry ${z} as ${hex} -- found no swatch matching it`);
  });
  console.log("[ok] สีสี่โซนในตำนาน index.html ตรงกับ QUADRANT_COLORS ใน app.js ทุกตัว");
}

// ---------------------------------------------------------------------------
// 12. The two drawing channels stay separate
// ---------------------------------------------------------------------------
{
  const pts = [
    { x: 110, y: 110, zone: "Leading", edge: "Core" },
    { x: 100.2, y: 110, zone: "Improving", edge: "Edge" }
  ];
  // Size encodes recency FIRST -- the newest point is the biggest -- and the
  // Edge shrink rides on top of that. So the comparison that means anything
  // is like-for-like: the same point, Core vs Edge, not newest vs oldest.
  const asCore = QD.buildRotationPointStyles(
    [pts[0], { x: 110, y: 110, zone: "Leading", edge: "Core" }], "#2563eb", null);
  const asEdge = QD.buildRotationPointStyles(pts, "#2563eb", null);
  assert.ok(asEdge.pointRadius[1] < asCore.pointRadius[1],
    `the same newest point is drawn smaller when it is Edge (${asEdge.pointRadius[1]} vs ${asCore.pointRadius[1]})`);
  assert.strictEqual(asCore.pointRadius[0], asEdge.pointRadius[0], "the other points are untouched");
  assert.ok(Math.abs(asEdge.pointRadius[1] - (2 + 5) * QD.RRG_EDGE_RADIUS_FACTOR) < 1e-12,
    "the shrink is the named factor, not a magic number");
  assert.strictEqual(asEdge.pointBorderWidth[1], 0, "with no volume anomaly the border channel is untouched");
  const core = asCore.pointRadius[1];

  // Edge AND a volume spike at the same time: radius says Edge, border says
  // volume. มติ 31's note that the two must not be merged into one symbol.
  const withHalo = QD.buildRotationPointStyles(pts, "#2563eb", { zScore: 2.5, rvol: 1.8 });
  assert.ok(withHalo.pointRadius[1] < core, "still drawn small for Edge");
  assert.ok(withHalo.pointBorderWidth[1] > 0, "and still ringed for the volume anomaly");
  console.log("[ok] จุด Edge ย่อขนาด (ช่องรัศมี) · วงแหวน volume ยังอยู่ช่องขอบ · อ่านพร้อมกันได้ ไม่รวมเป็นสัญลักษณ์เดียว");

  // The band is only drawn where there is a threshold to draw.
  const silent = QD.rrgEdgeBandPlugin(null);
  let drew = 0;
  const fakeCtx = { save: () => drew++, restore: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, setLineDash: () => {} };
  silent.beforeDatasetsDraw({ ctx: fakeCtx, chartArea: { left: 0, right: 10, top: 0, bottom: 10 }, scales: { x: {}, y: {} } });
  assert.strictEqual(drew, 0, "no scale -> the band draws nothing rather than drawing it at zero width");
  console.log("[ok] แถบประของเกณฑ์ Edge ไม่วาดเลยเมื่อไม่มีเกณฑ์ (ไม่วาดที่ความกว้างศูนย์)");
}

// ---------------------------------------------------------------------------
// 13. The strip and the base-rate table as rendered
// ---------------------------------------------------------------------------
{
  const dom = loadPage();
  const win = dom.window;
  const Q = win.QD;
  const doc = win.document;
  Q.state.momentum.timeframe = "month";
  Q.state.momentum.volumeAnomalyById = {};

  const months = Q.zoneStripMonths("2026-11", 24);
  const hist = (specs) => specs.map(([pe, zone, edge], i) => ({ periodEnd: pe, zone, edge, axisIndex: i, x: 110, y: 110 }));
  const rotationData = {
    m: 12, k: 8, months,
    scale: { rsStep: 0.5, momStep: 0.4, rsEdge: 1, momEdge: 0.8, nSteps: 100 },
    results: [
      { instrumentId: 1, ticker: "AAA", points: [], history: hist([
        ["2026-09-30", "Leading", "Core"], ["2026-10-31", "Leading", "Core"], ["2026-11-30", "Leading", "Edge"]
      ]) },
      // two points with a visible flip, so its dwell is known exactly
      { instrumentId: 2, ticker: "BBB", points: [], history: hist([
        ["2026-10-31", "Leading", "Core"], ["2026-11-30", "Lagging", "Core"]
      ]) },
      { instrumentId: 3, ticker: "CCC", points: [], history: [] }
    ]
  };

  Q.renderZoneHistoryStrip(rotationData, [1, 2]);
  const strip = doc.getElementById("momZoneStrip");
  const tickerCells = Array.from(strip.querySelectorAll("span.w-14")).map((e) => e.textContent).filter((t) => t);
  assert.deepStrictEqual(plain(tickerCells), ["AAA", "BBB"],
    "one row per TICKED instrument -- CCC was not ticked and must not appear");

  const rows = Array.from(strip.children).filter((d) => d.querySelector("span.w-14") && d.querySelector("span.w-14").textContent);
  rows.forEach((row) => {
    const cells = row.querySelectorAll("span.w-5.h-4");
    assert.strictEqual(cells.length, 24, "every row is 24 cells wide, filled or not, so the columns line up");
  });

  // AAA was Leading in the last three months, so exactly three cells carry a
  // colour and they are the last three.
  const aaaCells = Array.from(rows[0].querySelectorAll("span.w-5.h-4"));
  const painted = aaaCells.map((c, i) => (c.getAttribute("style") ? i : -1)).filter((i) => i >= 0);
  assert.deepStrictEqual(plain(painted), [21, 22, 23], "the three months with data are the last three cells");
  assert.ok(/background-color:\s*#059669/.test(aaaCells[23].getAttribute("style")), "the newest cell is painted Leading green");
  assert.ok(/AAA 2026-11 · Leading – Edge/.test(aaaCells[23].getAttribute("title")),
    "the cell tooltip carries the same two words the table uses");
  assert.ok(/AAA 2026-05 · ไม่มีข้อมูล/.test(aaaCells[17].getAttribute("title")), "an empty cell says so rather than being blank");

  assert.ok(/≥ 3 เดือน/.test(rows[0].textContent), "AAA's run reaches the window start -> at-least, with the timeframe's unit");
  assert.ok(/1 เดือน/.test(rows[1].textContent) && !/≥ 1/.test(rows[1].textContent),
    "BBB's run started inside the window -> an exact number");
  assert.ok(/2024-12 ถึง 2026-11/.test(doc.getElementById("momZoneStripNote").textContent),
    "the note states the window in dates, so nobody has to count cells");
  console.log("[ok] DOM แถบ: แถวตามตัวที่ติ๊ก · 24 ช่องทุกแถว · ช่องที่มีข้อมูลอยู่ตำแหน่งปฏิทินถูก · tooltip ใช้คำเดียวกับตาราง · ≥ โชว์เมื่อถูกตัดปลาย");

  Q.renderZoneBaseRateTable(rotationData);
  const brt = doc.getElementById("momZoneBaseRateTable");
  const bodyRows = Array.from(brt.querySelectorAll("tbody tr"));
  assert.strictEqual(bodyRows.length, 4, "all four zones listed, every time");
  const cellsOf = (tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim());
  const leading = bodyRows.map(cellsOf).find((c) => c[0] === "Leading");
  // the dash now carries its own reason on screen, not in a title attribute
  assert.ok(/^—/.test(leading[1]), "3 transitions is far below the floor of 30 -> a dash");
  assert.ok(leading[1].includes("30"), "...and the cell itself says what the floor is");
  assert.strictEqual(leading[2], "3", "...but the denominator is shown so the dash is explainable (AAA 2 + BBB 1)");
  const lagging = bodyRows.map(cellsOf).find((c) => c[0] === "Lagging");
  assert.strictEqual(lagging[2], "0", "a zone with no observations is 0, not missing");

  // The base rates read the WHOLE universe, not the ticked subset: CCC and
  // the unticked BBB still count. A statistic that moved when someone ticks a
  // checkbox would not be a base rate.
  assert.ok(/ไม่ใช่เฉพาะที่ติ๊ก/.test(doc.body.textContent), "the page says so on screen, not only in this test");
  console.log("[ok] DOM ฐานอัตรา: ครบสี่โซน · ตัวหารน้อย = ขีดกลางแต่ยังเห็นตัวหาร · โซนที่ไม่เคยเจอเป็น 0 ไม่ใช่หาย");

  Q.renderZoneHistoryStrip({ months: [], results: [] }, []);
  assert.ok(/ยังไม่ได้เลือก|ยังไม่มีข้อมูล/.test(doc.getElementById("momZoneStrip").textContent),
    "nothing to draw -> a sentence, not an empty box");
  assert.strictEqual(doc.getElementById("momZoneStripNote").textContent, "", "...and no stale window note left behind");
  console.log("[ok] DOM: ไม่มีข้อมูลขึ้นข้อความบอก และไม่ทิ้งหมายเหตุช่วงเวลาค้างไว้");
}

// ---------------------------------------------------------------------------
// 14. The page explains the rules it applies
//
// The glossary is the only place on the page that defines these words for a
// reader. A rule that is applied but not written down is how two people end
// up with two understandings of the same column.
// ---------------------------------------------------------------------------
{
  const dom = loadPage();
  const win = dom.window;
  win.QD.renderMomentumGlossary();
  const text = win.document.getElementById("momGlossary").textContent;

  [
    ["Core / Edge", "the second word has a definition"],
    ["เส้นที่ใกล้ที่สุด", "and it says distance-to-the-nearest-axis, not distance-from-centre"],
    ["2 งวด", "...measured in two periods of normal movement"],
    ["ไม้วัดของตัวเอง", "...with a separate yardstick per axis"],
    ["อยู่มานาน", "the dwell column has a definition"],
    ["กรอบเวลาที่เลือกอยู่", "...which states its unit"],
    ["24 เดือนปฏิทิน", "the strip states its window in calendar months"],
    ["ไม่ใช่ความน่าจะเป็นไปข้างหน้า", "the base rate says in writing that it is not a forecast"],
    ["ต่ำกว่า 30", "...and states the floor under which it shows a dash"]
  ].forEach(([needle, why]) => {
    assert.ok(text.includes(needle), `glossary must contain "${needle}" -- ${why}`);
  });

  assert.ok(!/8 กลุ่ม|8-Group|octant/i.test(text),
    "and must no longer promise an 8-group label, which the page cannot produce any more");
  console.log("[ok] คำอธิบายบนหน้าเว็บ: นิยาม Core/Edge · หน่วยของอยู่มานาน · ช่วงของแถบ · คำเตือนว่าฐานอัตราไม่ใช่คำทำนาย + เกณฑ์ขีดกลาง · ไม่เหลือคำว่า 8 กลุ่ม");
}

// ---------------------------------------------------------------------------
// 15. หน่วยต้องอ่านได้โดยไม่ต้องแปลงในหัว (23 พ.ย. · รอบเล็กหลังเห็นของจริง)
//
// แถบเป็นเดือนเสมอ แต่ตัวเลขข้างมันเป็นงวดของกรอบเวลา — พอเปิดโหมดรายวันจริง
// มันอ่านว่า "85 วันทำการ" ข้างแถวที่มี 24 ช่องเดือน ซึ่งเทียบกันด้วยตาไม่ได้
// ---------------------------------------------------------------------------
{
  const dom = loadPage();
  const Q = dom.window.QD;
  const doc = dom.window.document;
  const set = (tf) => { Q.state.momentum.timeframe = tf; };
  const d = (periods, censored) => ({ dwellPeriods: periods, dwellCensored: !!censored });

  // ตารางสรุปไม่ต่อหน่วย เพราะหน่วยอยู่ในหัวคอลัมน์อยู่แล้ว
  set("day");
  assert.strictEqual(Q.formatDwell(d(85)), "85", "ในตารางสรุปยังเป็นตัวเลขเปล่า");
  assert.strictEqual(Q.formatDwell(d(85, true)), "≥ 85", "และยังบอกว่าถูกตัดปลาย");

  // ท้ายแถบพกหน่วยมาเอง และเติมเดือนโดยประมาณเมื่อหน่วยไม่ตรงกับช่อง
  assert.strictEqual(Q.formatDwell(d(85), true), "85 วันทำการ (~4 เดือน)");
  assert.strictEqual(Q.formatDwell(d(85, true), true), "≥ 85 วันทำการ (~4 เดือน)",
    "เครื่องหมาย ≥ ครอบทั้งก้อน ไม่ใช่ครอบแค่ตัวเลขหน้า");
  assert.strictEqual(Q.formatDwell(d(14), true), "14 วันทำการ",
    "ไม่ถึงหนึ่งเดือน ไม่ต้องเติมวงเล็บ เพราะ ~0 เดือน ไม่ได้บอกอะไร");
  assert.strictEqual(Q.formatDwell(d(1), true), "1 วันทำการ");

  set("week");
  assert.strictEqual(Q.formatDwell(d(30), true), "30 สัปดาห์ (~7 เดือน)");
  assert.strictEqual(Q.formatDwell(d(3), true), "3 สัปดาห์", "ต่ำกว่าหนึ่งเดือน");

  set("month");
  assert.strictEqual(Q.formatDwell(d(12), true), "12 เดือน",
    "รายเดือนไม่มีวงเล็บ เพราะช่องกับตัวเลขเป็นหน่วยเดียวกันอยู่แล้ว");
  assert.strictEqual(Q.formatDwell(d(12, true), true), "≥ 12 เดือน");

  assert.strictEqual(Q.formatDwell(null, true), "—", "ไม่มีค่าก็ยังไม่ throw");
  assert.strictEqual(Q.formatDwell({ dwellPeriods: null }, true), "—");
  console.log("[ok] อยู่มานาน: ท้ายแถบพกหน่วย + เดือนโดยประมาณ · ตารางสรุปเป็นเลขเปล่า · ต่ำกว่า 1 เดือนไม่เติมวงเล็บ · รายเดือนไม่เติม");

  // หน่วยในหัวคอลัมน์ฐานอัตราต้องเดินตามกรอบเวลาด้วย ไม่งั้น 98.6% ในรายวัน
  // กับ 91.2% ในรายเดือน อ่านเหมือนเป็นคำถามเดียวกันทั้งที่คนละคำถาม
  const rates = { months: [], scale: null, results: [] };
  const fake = (zone, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: 110, y: 110, zone, axisIndex: i });
    return out;
  };
  rates.results = [{ instrumentId: 1, ticker: "AAA", points: [], history: fake("Leading", 40) }];
  for (const [tf, word] of [["day", "วันทำการ"], ["week", "สัปดาห์"], ["month", "เดือน"]]) {
    set(tf);
    Q.renderZoneBaseRateTable(rates);
    const head = doc.getElementById("momZoneBaseRateTable").querySelectorAll("thead th")[1].textContent;
    assert.ok(head.includes(word), `หัวคอลัมน์ต้องบอกว่า "${word}ถัดไป" ในโหมด ${tf} · ได้ "${head}"`);
  }
  console.log("[ok] หัวคอลัมน์ฐานอัตราเปลี่ยนหน่วยตามกรอบเวลา (วันทำการ / สัปดาห์ / เดือน)");

  // ขีดกลางต้องอธิบายตัวเองบนจอ ไม่ใช่ซ่อนเหตุผลไว้ใน title
  set("month");
  rates.results = [{ instrumentId: 1, ticker: "AAA", points: [], history: fake("Leading", 5) }];
  Q.renderZoneBaseRateTable(rates);
  const leadCells = Array.from(doc.getElementById("momZoneBaseRateTable").querySelectorAll("tbody tr"))
    .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim()))
    .find((c) => c[0] === "Leading");
  assert.strictEqual(leadCells[2], "4", "4 การเปลี่ยนงวด");
  assert.ok(/^—/.test(leadCells[1]) && leadCells[1].includes(String(Q.ZONE_BASE_RATE_MIN_N)),
    `ขีดกลางต้องพกเกณฑ์มาด้วยในตัวเซลล์เอง · ได้ "${leadCells[1]}"`);
  console.log("[ok] ขีดกลางเขียนเกณฑ์ไว้ในเซลล์ อ่านได้โดยไม่ต้องเอาเมาส์ไปชี้");
}

// ---------------------------------------------------------------------------
// 16. แถบมีหัวคอลัมน์ และหัวต้องไม่ไปกวนการนับแถว
// ---------------------------------------------------------------------------
{
  const dom = loadPage();
  const Q = dom.window.QD;
  const doc = dom.window.document;
  Q.state.momentum.timeframe = "month";
  Q.state.momentum.volumeAnomalyById = {};
  const months = Q.zoneStripMonths("2026-11", 24);
  const hist = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ periodEnd: months[months.length - n + i] + "-28", x: 110, y: 110, zone: "Leading", edge: "Core", axisIndex: i });
    }
    return out;
  };
  const rot = { months, scale: { rsEdge: 1, momEdge: 1 }, results: [
    { instrumentId: 1, ticker: "AAA", points: [], history: hist(4) },
    { instrumentId: 2, ticker: "BBB", points: [], history: hist(2) }
  ] };
  Q.renderZoneHistoryStrip(rot, [1, 2]);
  const strip = doc.getElementById("momZoneStrip");

  assert.ok(strip.textContent.includes("อยู่มานาน"), "แถบมีหัวบอกว่าคอลัมน์ขวาสุดคืออะไร");

  // หัวใช้ช่องล่องหนเพื่อจัดคอลัมน์ จึงต้องมีจำนวนเท่าเดือน แต่ต้องไม่ถูกนับเป็นช่องข้อมูล
  const dataRows = Array.from(strip.children).filter((el) => el.querySelectorAll("span.w-5.h-4").length > 0);
  assert.strictEqual(dataRows.length, 2, "ยังนับได้ 2 แถวข้อมูล หัวกับแกนไม่ถูกนับ");
  const headRow = strip.children[0];
  assert.strictEqual(headRow.querySelectorAll("span.w-5.h-4").length, 0, "หัวไม่มีช่องข้อมูล");
  assert.strictEqual(headRow.querySelectorAll("span.w-5").length, months.length,
    "แต่มีช่องล่องหนครบ 24 ช่อง เพื่อให้คำว่า 'อยู่มานาน' อยู่ตรงคอลัมน์เดียวกับตัวเลข");
  console.log("[ok] แถบมีหัวคอลัมน์ · จัดตรงด้วยช่องล่องหนที่นับจากเดือนจริง · ไม่กวนการนับแถวข้อมูล");
}

console.log("\nALL ROTATION ENGINE TESTS PASSED");
