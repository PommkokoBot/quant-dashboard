// Real-browser check for the 2026-10-30 security round, extended for round A
// (2026-11-10). jsdom cannot do any of this: it does not enforce CSP, does not
// apply CSS, and does not run SheetJS.
// Served over http://127.0.0.1 because 'self' means nothing on file://.
//
// Round A matters here more than anywhere else: the app moved into app.js and
// the policy lost its hash, so this is the only place that can prove the
// browser really runs the external script, really refuses an inline one, and
// really decodes the Thai text in app.js.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

// The browser lives in a different place on every machine, so take it from the
// environment first, then from playwright itself, then from the usual spots.
// A hardcoded path makes this tool unrunnable for everyone but its author.
function chromePath() {
  const tries = [process.env.QD_CHROME];
  try { tries.push(chromium.executablePath()); } catch { /* not installed here */ }
  tries.push(
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium"
  );
  const found = tries.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("no Chromium found -- set QD_CHROME=<path to chrome>");
  return found;
}

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]) === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(8099, "127.0.0.1", r));
  const browser = await chromium.launch({ executablePath: chromePath() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const violations = [], errors = [], consoleErr = [], offsite = [], fontReqs = [];
  page.on("request", (req) => {
    const u = req.url();
    if (!u.startsWith("http://127.0.0.1:8099/")) offsite.push(u);
    if (/\.woff2?$/.test(u)) fontReqs.push(u.split("/").pop());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErr.push(m.text()); });
  await page.addInitScript(() => {
    window.__QD_TEST__ = true;
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__violations.push(e.violatedDirective + " <- " + (e.blockedURI || "inline")));
  });
  await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle" });

  const r = await page.evaluate(() => {
    const css = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
    // SheetJS under CSP: build a tiny workbook and serialise it in memory
    let xlsxOk = "not run";
    try {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", 1], ["b", 2]]), "T");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
      xlsxOk = out && out.length > 100 ? "ok (" + out.length + " b64 chars)" : "empty";
    } catch (e) { xlsxOk = "FAILED: " + e.message; }
    // The disclaimer row is built by app.js, so seeing it in Thai proves the
    // browser decoded the external file as UTF-8 -- something an inline script
    // got for free from the page's own charset.
    let thaiFromApp = "not run";
    try {
      const flat = QD.buildAboutSheet("Seasonality").map((r) => r.join(" ")).join("\n");
      thaiFromApp = flat.includes("ไม่ใช่คำแนะนำการลงทุน") ? "ok" : "MOJIBAKE: " + flat.slice(0, 60);
    } catch (e) { thaiFromApp = "FAILED: " + e.message; }

    return {
      qdLoaded: typeof window.QD === "object" && typeof window.QD.computeEventStudy === "function",
      version: window.QD && window.QD.APP_VERSION,
      thaiFromApp,
      chartJs: typeof window.Chart === "function",
      supabaseJs: !!(window.supabase && window.supabase.createClient),
      xlsx: xlsxOk,
      // Tailwind classes must actually paint
      cardBg: css("#authScreen .bg-white", "backgroundColor"),
      cardRadius: css("#authScreen .bg-white", "borderRadius"),
      btnBg: css("#loginSubmitBtn", "backgroundColor"),
      bodyFont: css("body", "fontFamily"),
      noticeVisible: !!document.getElementById("privacyNotice").offsetHeight,
      disclaimerText: document.getElementById("authDisclaimer").textContent.trim().slice(0, 40),
      violations: window.__violations
    };
  });
  // Positive proof that the policy is ENFORCED, not merely present: an inline
  // script added at runtime must not run. Before round A the policy carried a
  // hash and this could not be asserted; `script-src 'self'` makes it a clean
  // yes/no. Run after the load-time violation count has been taken.
  const loadViolations = r.violations.length;
  const inlineBlocked = await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__INLINE_RAN = true;";
    document.body.appendChild(s);
    return window.__INLINE_RAN === undefined;
  });

  console.log(r);
  console.log("inline <script> injected at runtime was blocked:", inlineBlocked);
  console.log("font files requested:", fontReqs.length ? fontReqs : "(none)");
  console.log("requests that left our origin:", offsite.length ? offsite : "(none)");
  await page.screenshot({ path: path.join(ROOT, "shot-login.png") });

  // dashboard chrome: show it and shoot the footer + version chip
  await page.evaluate(() => {
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("dashboardScreen").classList.remove("hidden");
    document.getElementById("appVersionChip").textContent = "v" + window.QD.APP_VERSION;
  });
  await page.locator("header").screenshot({ path: path.join(ROOT, "shot-header.png") });
  await page.locator("#appFooter").screenshot({ path: path.join(ROOT, "shot-footer.png") });

  const ok = offsite.length === 0 && fontReqs.length > 0 && r.qdLoaded && r.chartJs && r.supabaseJs && String(r.xlsx).startsWith("ok")
    && r.cardBg === "rgb(255, 255, 255)" && r.btnBg === "rgb(37, 99, 235)"
    && r.thaiFromApp === "ok" && inlineBlocked
    && loadViolations === 0 && errors.length === 0;
  await browser.close();
  server.close();
  if (errors.length) console.log("PAGE ERRORS:", errors);
  if (consoleErr.length) console.log("CONSOLE ERRORS:", consoleErr.slice(0, 5));
  console.log(ok ? "\nBROWSER CHECK PASSED" : "\nBROWSER CHECK FAILED");
  process.exit(ok ? 0 : 1);
})();
