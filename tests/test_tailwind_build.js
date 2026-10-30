// Tailwind build coverage (2026-10-30 round).
// The page used to load the Tailwind Play CDN, which compiled classes in the
// browser. It now ships a CSS file built from index.html, so a class added
// later without rebuilding the CSS would silently lose its styling -- nothing
// on screen says why. This test is that guard.
//
//   rebuild:  npx tailwindcss -c tailwind.config.js -i tw-input.css -o assets/tailwind.css --minify
//
// Usage: QD_HTML=<index.html> node tests/test_tailwind_build.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const FILE = path.resolve(__dirname, process.env.QD_HTML || "../index.html");
const html = fs.readFileSync(FILE, "utf8");
const css = fs.readFileSync(path.resolve(path.dirname(FILE), "assets/tailwind.css"), "utf8");
const inlineStyle = (html.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];

// Classes used only as JavaScript selectors / state markers -- they are never
// meant to carry styling, so they appear in neither stylesheet.
const HOOKS = new Set([
  "mom-preset-btn", "qd-row", "variant-enabled", "variant-asset", "variant-periodtype",
  "variant-period", "variant-lookback", "mom-col-cb", "mom-col-move", "mom-sel-cb",
  "mom-rrg-cb", "corr-cb", "corr-cell"
]);

// A class="" value may contain a JS expression (template literals build most of
// the tables). Keep only the literal, utility-shaped tokens.
const SHAPE = /^[a-z0-9][a-z0-9:_\\[\]().,/%#-]*$/i;
const tokens = new Set();
for (const m of html.matchAll(/class="([^"]*)"/g)) {
  for (const raw of m[1].split(/\s+/)) {
    const t = raw.trim();
    if (!t || t.includes("${") || t.includes("}") || t.includes("'") || t.includes('"')) continue;
    if (!SHAPE.test(t) || HOOKS.has(t)) continue;
    tokens.add(t);
  }
}
assert.ok(tokens.size > 150, "found a realistic number of classes to check (got " + tokens.size + ")");

const escapeForCss = (t) => "." + t.replace(/[:[\]/.%#(),]/g, (c) => "\\" + c);
const missing = [...tokens].filter((t) => !css.includes(escapeForCss(t)) && !inlineStyle.includes("." + t));
assert.deepStrictEqual(missing, [],
  "these classes are used in index.html but exist in neither assets/tailwind.css nor the inline <style> -- rebuild the CSS:\n  " + missing.join("\n  "));
console.log(`[ok] all ${tokens.size} utility classes used in index.html are present in the built CSS (responsive, hover and arbitrary-value variants included)`);

// The custom classes must stay in the inline <style>: Tailwind never emits them
["qd-badge-pass", "qd-badge-fail", "qd-badge-na", "qd-tab-active", "sticky-col", "spinner"].forEach((c) =>
  assert.ok(inlineStyle.includes("." + c), c + " is defined in the inline <style> block"));
assert.ok(css.length > 8000 && css.length < 400000, "the built CSS is a real build, not an empty or unpurged file (" + css.length + " bytes)");
console.log("[ok] custom classes still come from the inline <style>; the built CSS is purged (" + Math.round(css.length / 1024) + " KB, was ~3 MB of Play CDN runtime)");

console.log("\nALL TAILWIND BUILD TESTS PASSED");
