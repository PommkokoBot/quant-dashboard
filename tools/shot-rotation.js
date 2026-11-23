// ภาพหน้าจอของบล็อก RRG ในเบราว์เซอร์จริง (ไม่ใช่ jsdom)
//
// jsdom ไม่จัด layout จึงพิสูจน์ไม่ได้สามอย่างที่รอบนี้เพิ่ม:
//   1. แถบ 24 ช่อง × หลายแถว สูงเท่าไร และล้นจอแนวนอนหรือเปล่า
//   2. ช่องในแต่ละแถวตรงคอลัมน์กันจริงไหม (ทั้งหมดของแถบคือข้อนี้)
//   3. ตารางสรุป 9 คอลัมน์ยังอ่านได้ที่ความกว้างปกติ
//
// ป้อนข้อมูลสังเคราะห์ตรงเข้า renderer ผ่าน CDP (page.evaluate ไม่ใช่
// inline script จึงไม่ติด CSP) แล้ววัดขนาดจริงกับถ่ายภาพ
//
//   node tools/shot-rotation.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

function chromePath() {
  const tries = [process.env.QD_CHROME];
  try { tries.push(chromium.executablePath()); } catch { /* not installed */ }
  tries.push("/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium");
  const found = tries.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("no Chromium found -- set QD_CHROME=<path to chrome>");
  return found;
}

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(ROOT, rel === "/" ? "index.html" : rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(8099, "127.0.0.1", r));
  const browser = await chromium.launch({ executablePath: chromePath() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle" });

  const measured = await page.evaluate(() => {
    const Q = window.QD;
    // Eleven tickers, like us_sector -- the realistic row count for the strip.
    const TICKERS = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"];
    const ZONES = ["Leading", "Improving", "Lagging", "Weakening"];
    let seed = 20261123;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

    const months = Q.zoneStripMonths("2026-11", 24);
    const results = TICKERS.map((t, i) => {
      // Each fund walks its own zone path; the first two start late on
      // purpose, so the blank-cells-stay-in-place case is in the picture.
      const skip = i === 0 ? 7 : (i === 1 ? 3 : 0);
      let z = ZONES[i % 4];
      const history = months.slice(skip).map((ym, j) => {
        if (rnd() < 0.18) z = ZONES[Math.floor(rnd() * 4)];
        const x = 100 + (z === "Leading" || z === "Weakening" ? 1 : -1) * (0.2 + rnd() * 6);
        const y = 100 + (z === "Leading" || z === "Improving" ? 1 : -1) * (0.2 + rnd() * 5);
        return { periodEnd: ym + "-28", x, y, axisIndex: skip + j, zone: Q.classifyQuadrant(x, y) };
      });
      const scaleGuess = { rsEdge: 1.1, momEdge: 0.76 };
      history.forEach((p) => { p.edge = Q.classifyEdge(p.x, p.y, scaleGuess); });
      return {
        instrumentId: i + 1, ticker: t,
        history,
        points: history.slice(-12)
      };
    });
    const scale = Q.rotationStepScale(results.map((r) => r.history));
    results.forEach((r) => {
      r.history.forEach((p) => { p.edge = Q.classifyEdge(p.x, p.y, scale); });
      r.points.forEach((p) => { p.edge = Q.classifyEdge(p.x, p.y, scale); });
    });
    const rotationData = { m: 12, k: 8, months, scale, results };

    Q.state.momentum.timeframe = "month";
    Q.state.momentum.volumeAnomalyById = {};
    Q.state.momentum.rotationData = rotationData;
    Q.state.momentum.rrgSelectedIds = results.map((r) => r.instrumentId);
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("dashboardScreen").classList.remove("hidden");
    document.getElementById("tabMomentum").classList.remove("hidden");

    Q.renderRotationSummaryTable(rotationData, Q.state.momentum.rrgSelectedIds);
    Q.renderZoneHistoryStrip(rotationData, Q.state.momentum.rrgSelectedIds);
    Q.renderZoneBaseRateTable(rotationData);
    Q.renderMomentumGlossary();

    // --- the measurements jsdom cannot make ---
    const strip = document.getElementById("momZoneStrip");
    const box = strip.parentElement; // the overflow-x-auto wrapper
    const rows = Array.from(strip.children).filter((d) => d.querySelectorAll("span.w-5.h-4").length > 0);
    const cellRows = rows.filter((r) => r.querySelectorAll("span.w-5.h-4").length === 24);
    // Do the cells of different rows actually line up? Compare the left edge
    // of cell #7 across every row -- this is the only property the strip
    // exists for, and it is invisible to jsdom.
    const col7 = cellRows.map((r) => Math.round(r.querySelectorAll("span.w-5.h-4")[7].getBoundingClientRect().left));
    const summary = document.getElementById("momRotationSummaryTable");
    return {
      stripRows: rows.length,
      stripRowsWith24Cells: cellRows.length,
      stripHeight: Math.round(strip.getBoundingClientRect().height),
      stripScrollWidth: strip.scrollWidth,
      boxClientWidth: box.clientWidth,
      overflowsHorizontally: strip.scrollWidth > box.clientWidth + 1,
      column7LeftEdges: Array.from(new Set(col7)),
      summaryColumns: summary.querySelectorAll("thead th").length,
      summaryScrollWidth: summary.scrollWidth,
      scale: { rsEdge: Number(scale.rsEdge.toFixed(4)), momEdge: Number(scale.momEdge.toFixed(4)), nSteps: scale.nSteps },
      edgeCount: results.filter((r) => r.points[r.points.length - 1].edge === "Edge").length
    };
  });

  const rrg = page.locator("#momZoneStrip").locator("xpath=ancestor::section[1]");
  await rrg.screenshot({ path: path.join(ROOT, "shot-rotation.png") });

  await page.setViewportSize({ width: 390, height: 900 });
  const narrow = await page.evaluate(() => {
    const strip = document.getElementById("momZoneStrip");
    const box = strip.parentElement;
    const section = strip.closest("section");
    const withIt = document.documentElement.scrollWidth;
    // This page already scrolled sideways at 390px before this round (the
    // 4-button tab bar measured 524px), so the number that matters is not
    // "does it scroll" but "did WE make it scroll any wider".
    section.style.display = "none";
    const withoutIt = document.documentElement.scrollWidth;
    section.style.display = "";
    return {
      viewport: window.innerWidth,
      boxClientWidth: box.clientWidth,
      stripScrollWidth: strip.scrollWidth,
      scrollableInsideItsBox: strip.scrollWidth > box.clientWidth,
      pageScrollWidthWithBlock: withIt,
      pageScrollWidthWithoutBlock: withoutIt,
      widthWeAdded: withIt - withoutIt
    };
  });
  await rrg.screenshot({ path: path.join(ROOT, "shot-rotation-390.png") });

  await browser.close();
  server.close();

  console.log("desktop 1280px:", measured);
  console.log("narrow 390px:", narrow);
  console.log("console errors:", errors.filter((e) => !/404/.test(e)));

  const problems = [];
  if (measured.stripRows !== 11) problems.push(`expected 11 strip rows, got ${measured.stripRows}`);
  if (measured.stripRowsWith24Cells !== 11) problems.push("some rows are not 24 cells wide");
  if (measured.column7LeftEdges.length !== 1) {
    problems.push(`cell #7 does not line up across rows: left edges ${measured.column7LeftEdges.join(", ")}`);
  }
  if (measured.overflowsHorizontally) problems.push("the strip overflows its box at 1280px");
  if (measured.summaryColumns !== 9) problems.push(`expected 9 summary columns, got ${measured.summaryColumns}`);
  const perRow = measured.stripHeight / (measured.stripRows + 1); // + the month axis
  if (perRow > 26) problems.push(`the strip costs ${perRow.toFixed(1)}px per row -- more than one line of text`);
  if (!narrow.scrollableInsideItsBox) problems.push("at 390px the strip is not scrollable inside its own box");
  if (narrow.widthWeAdded > 0) problems.push(`the new block widened the PAGE by ${narrow.widthWeAdded}px at 390px`);

  if (problems.length) {
    console.error("\nROTATION LAYOUT CHECK FAILED");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }
  console.log("\nROTATION LAYOUT CHECK PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
