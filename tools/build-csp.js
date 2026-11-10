#!/usr/bin/env node
/**
 * Checks (and can rewrite) the Content-Security-Policy meta tag in index.html.
 *
 * Until 2026-11-10 the whole app lived in one inline <script>, so the policy had
 * to pin that script by its sha256 hash -- and every edit to the app changed the
 * hash. Forgetting to re-run this script published a page whose script the
 * browser refused to execute, with nothing on screen to say why. That is the
 * failure this project kept writing rules about.
 *
 * Round A moved the app into app.js. `script-src 'self'` now covers it, the
 * hash is gone, and editing the app can no longer invalidate the policy. There
 * is nothing left to remember.
 *
 * What stays worth guarding is the policy itself: that it has not been widened,
 * and that no inline <script> has crept back in -- because 'self' would not
 * cover one, and the page would fail in exactly the old silent way.
 *
 *   node tools/build-csp.js            # check only, exits 1 when wrong
 *   node tools/build-csp.js --write    # rewrite the meta tag
 *
 * tests/test_security.js asserts the same two invariants, so CI catches it
 * either way.
 */
const fs = require("fs");
const path = require("path");

// QD_HTML lets the mutation check point this at another build, the same way the
// test suites accept it. Without it the tool can only ever inspect itself.
const FILE = process.env.QD_HTML
  ? path.resolve(process.env.QD_HTML)
  : path.resolve(__dirname, "..", "index.html");
const SUPABASE = "https://nsbreucmgfmphmfewnbw.supabase.co";

// Fixed: nothing in it depends on the contents of any file any more.
const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  // inline <style> block + style="" attributes + the styles Chart.js sets on its canvas
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  `connect-src ${SUPABASE}`,
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

function currentPolicy(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  return m ? m[1] : null;
}

// A <script> tag with no src attribute. 'self' does not cover inline code, so
// one of these means a page that loads and then does nothing.
function inlineScript(html) {
  return html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/);
}

function main() {
  const html = fs.readFileSync(FILE, "utf8");

  if (inlineScript(html)) {
    console.error("index.html contains an inline <script>.");
    console.error("  script-src 'self' does not cover inline code: the published page would");
    console.error("  load and silently do nothing. Move the code into app.js.");
    process.exit(1);
  }

  const have = currentPolicy(html);
  if (have === POLICY) { console.log("CSP up to date"); return; }

  if (!process.argv.includes("--write")) {
    console.error("CSP does not match the expected policy -- run: node tools/build-csp.js --write");
    console.error("  have: " + (have || "(no meta tag)"));
    console.error("  want: " + POLICY);
    process.exit(1);
  }

  const out = have === null
    ? html.replace('<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n<meta http-equiv="Content-Security-Policy" content="${POLICY}" />`)
    : html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/, `$1${POLICY}$2`);
  fs.writeFileSync(FILE, out);
  console.log("CSP written");
}
main();
