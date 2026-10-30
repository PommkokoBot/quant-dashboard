// Security + release-standard checks for the Quant Dashboard page itself
// (2026-10-30 round). Pure text/DOM checks -- no network, no database.
// Usage: QD_HTML=<index.html> node tests/test_security.js
//
// Why these and not "does CSP work": a browser enforces the policy, a test can
// only prove the policy is PRESENT, CORRECT FOR THIS BUILD, and not quietly
// widened. The byte-level check that matters is the inline-script hash: if the
// app script is edited and tools/build-csp.js is not re-run, the published page
// loads with a dead script and nothing on screen says why.

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const crypto = require("crypto");
const { JSDOM } = require("jsdom");

const FILE = path.resolve(__dirname, process.env.QD_HTML || "../index.html");
const html = fs.readFileSync(FILE, "utf8");
const SUPABASE = "https://nsbreucmgfmphmfewnbw.supabase.co";

// ---------------- 1. CSP exists, is enforcing, and matches THIS build ----------------
const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
assert.ok(meta, "enforcing CSP meta tag present");
const csp = meta[1];
assert.ok(!/Report-Only/i.test(html), "Report-Only is not valid in a <meta> tag -- must be enforcing");
assert.ok(!/frame-ancestors/.test(csp), "frame-ancestors has no effect in a <meta> tag -- must not be there");

const inline = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inline, "the app's inline <script> block");
const hash = crypto.createHash("sha256").update(inline[1], "utf8").digest("base64");
assert.ok(csp.includes(`'sha256-${hash}'`),
  "CSP hash is STALE for this index.html -- run `node tools/build-csp.js --write`");
console.log("[ok] CSP present, enforcing, and its sha256 matches the inline script byte for byte");

// ---------------- 2. the policy is actually restrictive ----------------
const directive = (name) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) || "").slice(name.length + 1);
assert.ok(csp.startsWith("default-src 'none'"), "default-src locked down");
assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src must not fall back to unsafe-inline");
assert.ok(!/script-src[^;]*unsafe-eval/.test(csp), "script-src must not allow eval");
assert.ok(!/script-src[^;]*https?:\/\//.test(csp), "no third-party script origin may be allowed");
assert.strictEqual(directive("connect-src"), SUPABASE, "the page may only talk to our own Supabase project");
assert.ok(directive("font-src") === "https://fonts.gstatic.com", "fonts only from Google Fonts");
console.log("[ok] policy is restrictive: no remote scripts, no eval, network limited to our Supabase project");

// ---------------- 3. no library is loaded from a CDN any more ----------------
const scriptSrcs = Array.from(html.matchAll(/<script[^>]*src="([^"]+)"/g)).map((m) => m[1]);
assert.deepStrictEqual(scriptSrcs, ["vendor/chart.umd.js", "vendor/supabase.js", "vendor/xlsx.full.min.js"],
  "every library is served from this repo, in a fixed order");
scriptSrcs.forEach((src) => assert.ok(fs.existsSync(path.resolve(path.dirname(FILE), src)), src + " exists next to index.html"));
const cssHrefs = Array.from(html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)).map((m) => m[1]);
assert.ok(cssHrefs.includes("assets/tailwind.css"), "Tailwind is a local build, not the Play CDN");
assert.ok(fs.existsSync(path.resolve(path.dirname(FILE), "assets/tailwind.css")), "the built CSS exists");
assert.ok(!/cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/.test(html),
  "no cdn.tailwindcss.com / cdnjs / jsdelivr / unpkg reference survives anywhere in the page");
// Google Fonts is the one allowed remote origin: its CSS is generated per
// user-agent, so an integrity digest is impossible by design. Stylesheet only,
// never a script.
const remote = Array.from(html.matchAll(/https?:\/\/[^"'\s)]+/g)).map((m) => m[0])
  .filter((u) => !u.startsWith(SUPABASE) && !/fonts\.(googleapis|gstatic)\.com/.test(u)
    && !/chartjs\.org|supabase\.com\/docs|sheetjs\.com|w3\.org|github\.com|fred\.stlouisfed\.org|finance\.yahoo\.com/.test(u));
assert.deepStrictEqual(remote, [], "no unexpected remote origin in the page: " + remote.join(", "));
console.log("[ok] all three libraries + Tailwind are served from this repo; only Google Fonts remains remote (by design)");

// ---------------- 4. release standards: version + disclaimer + privacy ----------------
const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/", beforeParse(w) { w.__QD_TEST__ = true; } });
const QD = dom.window.QD, doc = dom.window.document;
assert.ok(/^\d+\.\d+\.\d+$/.test(QD.APP_VERSION), "APP_VERSION is a version number");
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(QD.APP_BUILD_DATE), "APP_BUILD_DATE is a date");
assert.ok(doc.getElementById("appVersionChip"), "the header shows the version");

const about = QD.buildAboutSheet("Seasonality");
const flat = about.map((r) => r.join(" ")).join("\n");
assert.ok(flat.includes(QD.APP_VERSION) && flat.includes(QD.APP_BUILD_DATE), "every export carries the build it came from");
assert.ok(flat.includes("ไม่ใช่คำแนะนำการลงทุน"), "every export carries the disclaimer");
assert.ok(flat.includes("Seasonality"), "the About sheet names the section it came from");

["appDisclaimer", "authDisclaimer", "privacyNotice"].forEach((id) =>
  assert.ok(doc.getElementById(id) && doc.getElementById(id).textContent.trim().length > 40, id + " is on the page with real text"));
const foot = doc.getElementById("appDisclaimer").textContent;
["ไม่ใช่คำแนะนำการลงทุน", "ผลในอดีตไม่ได้รับประกันผลในอนาคต"].forEach((phrase) =>
  assert.ok(foot.includes(phrase), "disclaimer says: " + phrase));
const privacy = doc.getElementById("privacyNotice").textContent;
["อีเมล", "Supabase", "mehresix@gmail.com"].forEach((phrase) =>
  assert.ok(privacy.includes(phrase), "privacy notice says what is stored / where / who to contact: " + phrase));
console.log("[ok] version chip + Excel About sheet + on-page disclaimer + PDPA notice (login screen and footer)");

// ---------------- 5. the Data Health rule that kept crying wolf ----------------
assert.strictEqual(QD.MACRO_SERIES_INFO.CPIAUCSL.maxAgeDays, 100,
  "CPI is dated at the start of its period and published mid-next-month: 70 days flags it every single month");
assert.strictEqual(QD.classifyMacroHealth({ series_id: "CPIAUCSL", last_date: "2026-09-01" }, "2026-11-14").status, "ok",
  "a normal pre-release gap (74 days) is no longer a problem");
assert.strictEqual(QD.classifyMacroHealth({ series_id: "CPIAUCSL", last_date: "2026-06-01" }, "2026-11-14").status, "warn",
  "a genuinely stuck CPI (166 days) is still caught");
console.log("[ok] CPI freshness rule widened to 100 days -- still red when CPI is actually stuck");

console.log("\nALL SECURITY / RELEASE-STANDARD TESTS PASSED");
