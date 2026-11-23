#!/usr/bin/env node
/**
 * Proves tests/test_rotation.js can go red.
 *
 * A golden-value suite that has only ever been seen passing proves nothing: if
 * the numbers it pins were never actually compared, it is a comment with a
 * green tick. So this file breaks the rotation engine on purpose, ten ways,
 * and fails if any break goes unnoticed.
 *
 * Every mutation here is a mistake a reimplementation would plausibly make --
 * which is the point, because the suite exists so the formula can be moved
 * into SQL with something to compare against. The EMA seed, the EMA alpha, the
 * null rules and the ROC offset are exactly the four places lessons.md warns
 * port silently wrong.
 *
 * Mechanics copied from tests/mutate_security.js: the mutated page is written
 * to a temp folder and the real suite is run against it through QD_HTML, from
 * this repo, so node_modules stays where it already is.
 *
 *   node tests/mutate_rotation.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const COPY = ["index.html", "app.js", "assets", "vendor"];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qd-mutate-rot-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));

const at = (f) => path.join(dir, f);
const read = (f) => fs.readFileSync(at(f), "utf8");
const write = (f, s) => fs.writeFileSync(at(f), s);

function restore() {
  for (const item of COPY) {
    fs.rmSync(at(item), { recursive: true, force: true });
    fs.cpSync(path.join(ROOT, item), at(item), { recursive: true });
  }
}

function runSuite(script) {
  try {
    execFileSync(process.execPath, [script], {
      cwd: ROOT, stdio: "pipe",
      env: { ...process.env, QD_HTML: at("index.html") }
    });
    return 0;
  } catch (e) {
    return e.status == null ? 1 : e.status;
  }
}

// Replaces `from` with `to` in app.js and fails loudly if the anchor is not
// unique -- a mutation whose anchor has drifted reports "caught" for the wrong
// reason, which is the failure mode this whole file exists to avoid.
function swap(from, to) {
  const src = read("app.js");
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`anchor found ${n} times, expected 1: ${from.slice(0, 70)}`);
  write("app.js", src.replace(from, to));
}

const SUITE = "tests/test_rotation.js";

const MUTATIONS = [
  { id: "R1", name: "EMA seeded on the first value instead of the mean of `period`",
    why: "the most common port mistake; every later value inherits the wrong start",
    apply: () => swap("if (seedCount === period) { prev = seedSum / period; out[i] = prev; }",
                      "if (seedCount === 1) { prev = seedSum; out[i] = prev; }") },

  { id: "R2", name: "EMA alpha = 1/period instead of 2/(period+1)",
    why: "both are called 'the' smoothing factor in different texts",
    apply: () => swap("const alpha = 2 / (period + 1);", "const alpha = 1 / period;") },

  { id: "R3", name: "EMA restarts its seed after a hole",
    why: "a natural reading of 'skip nulls' that quietly shortens every series with a gap",
    apply: () => swap("      if (v == null) continue;", "      if (v == null) { prev = null; seedSum = 0; seedCount = 0; continue; }") },

  { id: "R4", name: "SMA averages around a hole instead of returning null",
    why: "window functions in SQL ignore nulls by default, so a port inherits this for free",
    apply: () => swap("      if (win.some((v) => v == null)) continue;",
                      "      if (win.every((v) => v == null)) continue;") },

  { id: "R5", name: "SMA emits partial windows from index 0",
    why: "off-by-one at the warm-up edge; the series gets longer, not wrong-looking",
    apply: () => swap("      if (i < period - 1) continue;", "      if (i < 0) continue;") },

  { id: "R6", name: "ROC compares with the previous period instead of k back",
    why: "turns RS-Momentum into a one-period change while still producing ~100 values",
    apply: () => swap("(i >= k && v != null && rsRatio[i - k] != null && rsRatio[i - k] !== 0) ? (v / rsRatio[i - k] - 1)",
                      "(i >= 1 && v != null && rsRatio[i - 1] != null && rsRatio[i - 1] !== 0) ? (v / rsRatio[i - 1] - 1)") },

  { id: "R7", name: "k set to m instead of ~0.7*m",
    why: "dropping the convention is a one-character edit and the chart still looks like a chart",
    apply: () => swap("const k = Math.max(2, Math.round(m * 0.7));", "const k = Math.max(2, m);") },

  { id: "R8", name: "RS-Ratio built from raw rs, skipping the EMA",
    why: "the EMA looks redundant next to the rolling mean until you compare numbers",
    apply: () => swap("const rsRatio = emaRs.map((v, i) => (v != null && rollMean[i]) ? (100 * v / rollMean[i]) : null);",
                      "const rsRatio = rs.map((v, i) => (v != null && rollMean[i]) ? (100 * v / rollMean[i]) : null);") },

  { id: "R9", name: "the tail keeps the OLDEST points instead of the newest",
    why: "slice(0, n) and slice(-n) differ by one character and both return n points",
    apply: () => swap("points: r.all.slice(-tailLength).map(label)", "points: r.all.slice(0, tailLength).map(label)") },

  { id: "R10", name: "classifyQuadrant uses >= so a point ON the line counts as above it",
    why: "the boundary rule the new Core/Edge labels lean on; 'Lagging' silently becomes 'Leading'",
    apply: () => swap('if (y > 100) return x > 100 ? "Leading" : "Improving";\n    return x > 100 ? "Weakening" : "Lagging";',
                      'if (y >= 100) return x >= 100 ? "Leading" : "Improving";\n    return x >= 100 ? "Weakening" : "Lagging";') },

  // ---- the state/time rules added 2026-11-23 ----

  { id: "R11", name: "the Edge threshold is measured over the chart's tail",
    why: "มติ 36 exactly: dragging Tail shorter would silently relabel funds Core/Edge",
    apply: () => swap("const scale = rotationStepScale(computed.map((r) => r.history));",
                      "const scale = rotationStepScale(computed.map((r) => r.all.slice(-tailLength)));") },

  { id: "R12", name: "Edge measured from the centre instead of the nearest axis",
    why: "the alternative มติ 31 rejected: (110,110) and (110,100.5) are equally far from the centre",
    apply: () => swap("return (Math.abs(x - 100) < scale.rsEdge || Math.abs(y - 100) < scale.momEdge) ? \"Edge\" : \"Core\";",
                      "return (Math.hypot(x - 100, y - 100) < scale.rsEdge) ? \"Edge\" : \"Core\";") },

  { id: "R13", name: "Edge requires BOTH axes to be close instead of either",
    why: "reads naturally as 'near the crosshair' and only labels the corner, missing every axis-hugger",
    apply: () => swap("return (Math.abs(x - 100) < scale.rsEdge || Math.abs(y - 100) < scale.momEdge) ? \"Edge\" : \"Core\";",
                      "return (Math.abs(x - 100) < scale.rsEdge && Math.abs(y - 100) < scale.momEdge) ? \"Edge\" : \"Core\";") },

  { id: "R14", name: "one yardstick used for both axes",
    why: "the two axes do not move at the same speed; one threshold mislabels along the slower one",
    apply: () => swap("return (Math.abs(x - 100) < scale.rsEdge || Math.abs(y - 100) < scale.momEdge) ? \"Edge\" : \"Core\";",
                      "return (Math.abs(x - 100) < scale.rsEdge || Math.abs(y - 100) < scale.rsEdge) ? \"Edge\" : \"Core\";") },

  { id: "R15", name: "dwell never reports that the run is censored",
    why: "'5 periods' and 'at least 5 periods' are different claims; the window cannot tell them apart",
    apply: () => swap("    return { periods: n, censored: true };", "    return { periods: n, censored: false };") },

  { id: "R16", name: "dwell counts straight through a hole in the prices",
    why: "claims a zone held during months we have no value for",
    apply: () => swap("      if (z !== now || history[i + 1].axisIndex - history[i].axisIndex !== 1) {",
                      "      if (z !== now) {") },

  { id: "R17", name: "a base rate is printed however small its denominator",
    why: "6 funds monthly and 54 funds weekly differ by an order of magnitude; the floor is the only guard",
    apply: () => swap("pStay: total[z] >= ZONE_BASE_RATE_MIN_N ? stay[z] / total[z] : null",
                      "pStay: total[z] > 0 ? stay[z] / total[z] : null") },

  { id: "R18", name: "base rates count a jump across a gap as one transition",
    why: "inflates the denominator with observations that were never one period apart",
    apply: () => swap("        if (pts[i].axisIndex - pts[i - 1].axisIndex !== 1) continue;\n        const from = pts[i - 1].zone",
                      "        const from = pts[i - 1].zone") },

  { id: "R19", name: "the strip samples the FIRST period of each month",
    why: "a plausible reading of 'the month's zone' that reports stale state in every cell",
    apply: () => swap("    (history || []).forEach((p) => { byMonth.set(ymOf(p.periodEnd), p); });",
                      "    (history || []).forEach((p) => { if (!byMonth.has(ymOf(p.periodEnd))) byMonth.set(ymOf(p.periodEnd), p); });") },

  { id: "R20", name: "the strip drops empty months instead of leaving them blank",
    why: "rows stop lining up, so scanning a column downwards -- the point of the strip -- reads the wrong months",
    apply: () => swap("      return p ? { ym, zone: p.zone, edge: p.edge, periodEnd: p.periodEnd } : { ym, zone: null, edge: null, periodEnd: null };\n    });",
                      "      return p ? { ym, zone: p.zone, edge: p.edge, periodEnd: p.periodEnd } : null;\n    }).filter((c) => c);") }
];

restore();
if (runSuite(SUITE) !== 0) {
  console.error("the unmutated suite does not pass -- fix that before trusting any mutant");
  process.exit(1);
}
console.log("baseline: tests/test_rotation.js passes on the unmutated page\n");

let escaped = 0;
for (const m of MUTATIONS) {
  restore();
  try {
    m.apply();
  } catch (e) {
    console.log(`  ${m.id} BROKEN  ${m.name}\n         ${e.message}`);
    escaped++;
    continue;
  }
  const status = runSuite(SUITE);
  if (status === 0) {
    console.log(`  ${m.id} SLIPPED ${m.name}\n         ${m.why}`);
    escaped++;
  } else {
    console.log(`  ${m.id} caught  ${m.name}`);
  }
}

restore();
console.log(`\n${MUTATIONS.length - escaped}/${MUTATIONS.length} rotation mutants caught`);
process.exit(escaped === 0 ? 0 : 1);
