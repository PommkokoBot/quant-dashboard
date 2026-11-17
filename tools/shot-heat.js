// ภาพหน้าจอของ Heat Calendar ในเบราว์เซอร์จริง (ไม่ใช่ jsdom)
// jsdom ไม่จัด layout และไม่ระบายสี จึงพิสูจน์ไม่ได้ว่าตาราง 53 คอลัมน์ของโหมด
// สัปดาห์ล้นจอหรือเปล่า และสีที่ได้อ่านออกไหม · สคริปต์นี้ป้อนข้อมูลสังเคราะห์
// ที่ขนาดสมจริง (ผลตอบแทนรายเดือน sd ~4.5%) ผ่าน Supabase ปลอม แล้วถ่ายภาพ
//
//   node tools/shot-heat.js
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
  await new Promise((r) => server.listen(8098, "127.0.0.1", r));
  const browser = await chromium.launch({ executablePath: chromePath() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://127.0.0.1:8098/", { waitUntil: "networkidle" });

  await page.evaluate(async () => {
    // ตัวสุ่มที่ให้ผลเดิมทุกครั้ง เพื่อให้ภาพเทียบกันได้ข้ามรอบ
    let seed = 20261117;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const norm = () => { let s = 0; for (let i = 0; i < 12; i++) s += rnd(); return s - 6; };

    function series(id, granularity, startYear, endYear, drift, vol) {
      const rows = []; let px = 100;
      for (let y = startYear; y <= endYear; y++) {
        const n = granularity === "month" ? 12 : 52;
        for (let p = 1; p <= n; p++) {
          px *= 1 + (drift + vol * norm()) / 100;
          const d = granularity === "month"
            ? new Date(Date.UTC(y, p - 1 + 1, 0))
            : new Date(Date.UTC(y, 0, 1 + (p - 1) * 7 + 4));
          rows.push({ instrument_id: id, period_end: d.toISOString().slice(0, 10), adj_close: Number(px.toFixed(4)) });
        }
      }
      return rows;
    }

    const sb = {
      auth: { async getSession() { return { data: { session: null } }; },
              onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
      from() { const n = { select: () => n, eq: () => n, order: () => n, limit: () => n,
        then: (f) => Promise.resolve({ data: [], error: null }).then(f) }; return n; },
      rpc(name, args) {
        const b = { range: () => b, then(f) {
          if (name !== "period_end_closes") return Promise.resolve({ data: [], error: null }).then(f);
          const g = args.p_granularity;
          const rows = series(1, g, 2011, 2026, 0.9, 4.4).concat(series(2, g, 2011, 2026, 0.8, 3.9));
          return Promise.resolve({ data: rows, error: null }).then(f);
        } };
        return b;
      }
    };
    await window.QD.init(sb);
    window.QD.state.instruments = [
      { id: 1, ticker: "QQQ", name: "Invesco QQQ", category: "broad_market" },
      { id: 2, ticker: "SPY", name: "SPDR S&P 500", category: "broad_market" }
    ];
    window.QD.state.assetId = 1;
    window.QD.state.periodType = "month";
    window.QD.state.lookback = null;
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("dashboardScreen").classList.remove("hidden");
    await window.QD.fetchHeatCalendar();
  });

  const card = page.locator("#heatCalendarTable").locator("xpath=ancestor::section[1]");
  await card.screenshot({ path: path.join(ROOT, "shot-heat-month.png") });

  await page.click('[data-heat-mode="rel"]');
  await card.screenshot({ path: path.join(ROOT, "shot-heat-rel.png") });

  await page.evaluate(async () => {
    window.QD.state.periodType = "week";
    await window.QD.fetchHeatCalendar();
  });
  await card.screenshot({ path: path.join(ROOT, "shot-heat-week.png") });

  const widths = await page.evaluate(() => {
    const t = document.getElementById("heatCalendarTable");
    const box = t.parentElement;
    return { tableWidth: Math.round(t.scrollWidth), boxWidth: Math.round(box.clientWidth),
             docMinWidth: Math.round(document.documentElement.scrollWidth),
             rows: t.querySelectorAll("tbody tr").length,
             cols: t.querySelectorAll("thead th").length };
  });
  console.log("โหมดสัปดาห์:", widths);
  console.log("ภาพ: shot-heat-month.png · shot-heat-rel.png · shot-heat-week.png");

  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
