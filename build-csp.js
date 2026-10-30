#!/usr/bin/env node
/**
 * Rebuilds the Content-Security-Policy meta tag in index.html.
 *
 * The whole app lives in ONE inline <script>, so the policy pins that script by
 * its sha256 hash. Edit the script and the hash changes -- run this again or the
 * page loads with a dead script and nothing on screen says why.
 *
 *   node tools/build-csp.js            # check only, exits 1 when stale
 *   node tools/build-csp.js --write    # rewrite the meta tag
 *
 * tests/test_security.js runs the same check, so CI catches a forgotten run.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.resolve(__dirname, "..", "index.html");
const SUPABASE = "https://nsbreucmgfmphmfewnbw.supabase.co";

function inlineScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no inline <script> block found");
  return m[1];
}

function policyFor(html) {
  const hash = crypto.createHash("sha256").update(inlineScript(html), "utf8").digest("base64");
  return [
    "default-src 'none'",
    `script-src 'self' 'sha256-${hash}'`,
    // inline <style> block + style="" attributes + the styles Chart.js sets on its canvas
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src ${SUPABASE}`,
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");
}

function currentPolicy(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  return m ? m[1] : null;
}

function main() {
  const html = fs.readFileSync(FILE, "utf8");
  const want = policyFor(html);
  const have = currentPolicy(html);
  if (have === want) { console.log("CSP up to date"); return; }
  if (!process.argv.includes("--write")) {
    console.error("CSP is STALE -- run: node tools/build-csp.js --write");
    console.error("  have: " + (have || "(no meta tag)").slice(0, 120));
    console.error("  want: " + want.slice(0, 120));
    process.exit(1);
  }
  const out = have === null
    ? html.replace('<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n<meta http-equiv="Content-Security-Policy" content="${want}" />`)
    : html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/, `$1${want}$2`);
  fs.writeFileSync(FILE, out);
  console.log("CSP written");
}
main();
