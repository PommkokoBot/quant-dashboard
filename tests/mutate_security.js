#!/usr/bin/env node
/**
 * Proves that the guards which replaced the CSP hash can actually go red.
 *
 * Round A removed the inline script and the sha256 that pinned it. Two things
 * now stand in its place: test_security.js asserts that the page carries no
 * inline script and that script-src is exactly 'self', and tests/_page.js plus
 * tailwind.config.js assume the app lives in app.js. A suite that has only ever
 * been seen passing proves none of that, so this file breaks the page on
 * purpose, six ways, and fails if any break goes unnoticed.
 *
 * Each mutation is a thing that could really happen: code pasted back into the
 * page, a policy widened to "make it work", a build that drops app.js, a
 * stylesheet rebuilt without scanning it.
 *
 * Mechanics: the mutated page is written to a temp folder and the real suites
 * are run against it through QD_HTML, from this repo, so node_modules is simply
 * where it always is. (An earlier version symlinked node_modules into the temp
 * folder, which needs Administrator rights on Windows -- it worked on Linux and
 * failed on the machine that matters.)
 *
 *   node tests/mutate_security.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
// Everything test_security.js checks the existence of, next to the page.
const COPY = ["index.html", "app.js", "assets", "vendor"];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qd-mutate-"));
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

// Runs a real suite against the mutated page. Node resolves jsdom from this
// repo because that is where the process runs; only the page moves.
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

// Rebuilds the stylesheet the way `npm run build:css` would, but with whatever
// config the mutation left behind. Calls Tailwind's own entry point with node
// rather than npx, which is a .cmd on Windows and not directly executable.
function buildCss(configFile, outFile) {
  execFileSync(process.execPath, [
    path.join(ROOT, "node_modules", "tailwindcss", "lib", "cli.js"),
    "-c", configFile,
    "-i", path.join(ROOT, "tw-input.css"),
    "-o", outFile,
    "--minify"
  ], { cwd: ROOT, stdio: "pipe" });
}

const INLINE = "<script>window.QD_SNEAKY = 1;</script>\n</body>";

const MUTATIONS = [
  {
    id: "M1", name: "inline script pasted back",
    script: "tests/test_security.js",
    why: "code in the page would be blocked by script-src 'self' and silently never run",
    apply: () => write("index.html", read("index.html").replace("</body>", INLINE))
  },
  {
    id: "M2", name: "policy widened with unsafe-inline",
    script: "tests/test_security.js",
    why: "the usual way someone 'fixes' a blocked inline script, reopening XSS",
    apply: () => write("index.html", read("index.html")
      .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"))
  },
  {
    id: "M3", name: "app.js tag dropped from the page",
    script: "tests/test_security.js",
    why: "the page would load, render its shell and do nothing at all",
    apply: () => write("index.html", read("index.html")
      .replace('<script src="app.js"></script>', ""))
  },
  {
    id: "M4", name: "app.js shipped empty",
    script: "tests/test_security.js",
    why: "a truncated upload passes every structural check while shipping a dead page",
    apply: () => write("app.js", "// nothing\n")
  },
  {
    id: "M5", name: "stylesheet built without scanning app.js",
    script: "tests/test_tailwind_build.js",
    why: "every class the app builds in a template literal would lose its styling",
    apply: () => {
      // tailwind.config.js as it read before app.js was added to `content`
      const cfg = at("tw.indexonly.js");
      fs.writeFileSync(cfg, "module.exports = { content: [" +
        JSON.stringify(at("index.html").replace(/\\/g, "/")) +
        "], theme: { extend: {} }, plugins: [] };\n");
      buildCss(cfg, at(path.join("assets", "tailwind.css")));
    }
  },
  {
    id: "M6", name: "inline script, checked by the build tool",
    script: "tools/build-csp.js",
    why: "the tool CI runs must refuse a page that would load dead, not just report the policy",
    apply: () => write("index.html", read("index.html").replace("</body>", INLINE))
  }
];

restore();
const scripts = [...new Set(MUTATIONS.map((m) => m.script))];
if (scripts.map(runSuite).some((c) => c !== 0)) {
  console.error("baseline FAILS before any mutation -- fix the suite first");
  for (const s of scripts) console.error("  " + s + " -> exit " + runSuite(s));
  process.exit(1);
}
console.log("baseline (nothing broken): passes  [" + scripts.join(", ") + "]");

let missed = 0;
for (const m of MUTATIONS) {
  restore();
  m.apply();
  const caught = runSuite(m.script) !== 0;
  if (!caught) missed++;
  console.log(`${m.id} ${m.name.padEnd(42)} ${caught ? "caught " : "MISSED "} (${m.why})`);
}

console.log();
if (missed) {
  console.error(`${missed} mutation(s) slipped through -- the suite cannot be trusted`);
  process.exit(1);
}
console.log(`all ${MUTATIONS.length} mutations caught -- the suite can go red`);
