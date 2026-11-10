// Security + release-standard checks for the Quant Dashboard page itself
// (2026-10-30 round). Pure text/DOM checks -- no network, no database.
// Usage: QD_HTML=<index.html> node tests/test_security.js
//
// Why these and not "does CSP work": a browser enforces the policy, a test can
// only prove the policy is PRESENT, restrictive, and not quietly widened.
//
// Until 2026-11-10 the check that mattered most was a byte-level hash of the
// inline script, because editing the app without re-running tools/build-csp.js
// published a page whose script the browser refused to run, with nothing on
// screen to say why. Round A removed that failure mode at the source: the app
// ships as app.js and `script-src 'self'` covers it, so there is no digest left
// to go stale. What replaces the hash check is the invariant that makes it
// unnecessary -- the page carries no inline script at all.

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { loadPage } = require("./_page");

const FILE = path.resolve(__dirname, process.env.QD_HTML || "../index.html");
const html = fs.readFileSync(FILE, "utf8");
const SUPABASE = "https://nsbreucmgfmphmfewnbw.supabase.co";

// ---------------- 1. CSP exists, is enforcing, and matches THIS build ----------------
const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
assert.ok(meta, "enforcing CSP meta tag present");
const csp = meta[1];
assert.ok(!/Report-Only/i.test(html), "Report-Only is not valid in a <meta> tag -- must be enforcing");
assert.ok(!/frame-ancestors/.test(csp), "frame-ancestors has no effect in a <meta> tag -- must not be there");

const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
assert.ok(!inline, "the page carries no inline <script> -- script-src is 'self' and would block one");
assert.ok(!/'sha256-/.test(csp), "no script hash may remain in the policy; there is nothing left to hash");
assert.ok(/(^|;\s*)script-src 'self'\s*(;|$)/.test(csp), "script-src is exactly 'self'");
console.log("[ok] CSP present, enforcing, script-src 'self' with no inline script left to go stale");

// ---------------- 2. the policy is actually restrictive ----------------
const directive = (name) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) || "").slice(name.length + 1);
assert.ok(csp.startsWith("default-src 'none'"), "default-src locked down");
assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src must not fall back to unsafe-inline");
assert.ok(!/script-src[^;]*unsafe-eval/.test(csp), "script-src must not allow eval");
assert.ok(!/script-src[^;]*https?:\/\//.test(csp), "no third-party script origin may be allowed");
assert.strictEqual(directive("connect-src"), SUPABASE, "the page may only talk to our own Supabase project");
assert.strictEqual(directive("font-src"), "'self'", "fonts come from this repo, not from Google");
assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(csp), "no Google origin left in the policy");
console.log("[ok] policy is restrictive: no remote scripts, no eval, network limited to our Supabase project");

// ---------------- 3. no library is loaded from a CDN any more ----------------
const scriptSrcs = Array.from(html.matchAll(/<script[^>]*src="([^"]+)"/g)).map((m) => m[1]);
assert.deepStrictEqual(scriptSrcs, ["vendor/chart.umd.js", "vendor/supabase.js", "vendor/xlsx.full.min.js", "app.js"],
  "every script is served from this repo, in a fixed order, with the app loaded last");
scriptSrcs.forEach((src) => assert.ok(fs.existsSync(path.resolve(path.dirname(FILE), src)), src + " exists next to index.html"));
// A truncated or empty app.js would still satisfy every check above while
// shipping a page that does nothing.
const appBytes = fs.statSync(path.resolve(path.dirname(FILE), "app.js")).size;
assert.ok(appBytes > 100000, "app.js carries the application, not an empty or truncated file (" + appBytes + " bytes)");
const cssHrefs = Array.from(html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)).map((m) => m[1]);
assert.ok(cssHrefs.includes("assets/tailwind.css"), "Tailwind is a local build, not the Play CDN");
assert.ok(fs.existsSync(path.resolve(path.dirname(FILE), "assets/tailwind.css")), "the built CSS exists");
assert.ok(!/cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/.test(html),
  "no cdn.tailwindcss.com / cdnjs / jsdelivr / unpkg reference survives anywhere in the page");
assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html), "the Google Fonts <link> tags are gone");
const fontCss = fs.readFileSync(path.resolve(path.dirname(FILE), "assets/tailwind.css"), "utf8");
const faces = Array.from(fontCss.matchAll(/url\(['"]?(fonts\/[^'")]+)['"]?\)/g)).map((m) => m[1]);
assert.ok(faces.length >= 8, "@font-face rules for the self-hosted Sarabun (got " + faces.length + ")");
[...new Set(faces)].forEach((f) =>
  assert.ok(fs.existsSync(path.resolve(path.dirname(FILE), "assets", f)), "font file exists: assets/" + f));
// Nothing outside our own Supabase project may be referenced any more. URLs in
// comments/notes that are never fetched (docs, data sources) are not requests.
const remote = Array.from(html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)).map((m) => m[1])
  .filter((u) => !u.startsWith(SUPABASE));
assert.deepStrictEqual(remote, [], "the page fetches nothing from a third party: " + remote.join(", "));
console.log("[ok] libraries, CSS and the Sarabun font files all come from this repo — zero third-party origins left");

// ---------------- 4. release standards: version + disclaimer + privacy ----------------
const dom = loadPage();
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
