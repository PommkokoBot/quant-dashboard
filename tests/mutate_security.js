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
  },
  // ---- รอบ C′ (2026-11-15): แท็บ Brief + universe จากฐานข้อมูล ----
  // ทั้งห้าข้อนี้คือความพลาดที่ "ดูถูกต้องทุกวันที่ทุกอย่างปกติ" ซึ่งเป็น
  // ความพลาดชนิดเดียวที่ชุดเทสต์ต้องมีไว้จับ
  {
    id: "M7", name: "brief tab shows the newest row",
    script: "tests/test_brief_tab.js",
    why: "the obvious one-liner: a brief that failed the gates would replace the published one on the page",
    apply: () => write("app.js", read("app.js").replace(
      'return (rows || []).find((r) => r.status === "published") || null;',
      "return (rows || [])[0] || null;"))
  },
  {
    id: "M8", name: "newer held briefs reported silently",
    script: "tests/test_brief_tab.js",
    why: "the reader would not know the numbers on screen are from an older week",
    apply: () => write("app.js", read("app.js").replace(
      'return (rows || []).filter((r) => r.status !== "published" && String(r.trade_date) > cut);',
      "return [];"))
  },
  {
    id: "M9", name: "brief body injected as HTML",
    script: "tests/test_brief_tab.js",
    why: "daily_brief holds text a model wrote; unescaped it is a script tag away from running",
    apply: () => write("app.js", read("app.js").replace(
      '<p class="text-sm leading-7 text-slate-700">${escapeHtml(s.text)}</p>',
      '<p class="text-sm leading-7 text-slate-700">${s.text}</p>'))
  },
  {
    id: "M10", name: "brief tab never loads",
    script: "tests/test_brief_tab.js",
    why: "an empty tab with no error reads as 'no brief yet' forever",
    apply: () => write("app.js", read("app.js").replace(
      'if (tab === "brief" && !state.brief.loaded && !state.brief.loading) loadBriefTab();', ""))
  },
  // ---- Heat Calendar (2026-11-17) ----
  // สี่ข้อแรกคือความพลาดที่ตารางยังวาดออกมาสวยเหมือนเดิมทุกช่อง ผิดแต่ตัวเลข
  // หรือผิดแต่ความหมายของสี ซึ่งตาคนมองไม่ออกจากหน้าจอ
  {
    id: "M12", name: "ISO week ลืมเลื่อนไปวันพฤหัสฯ",
    script: "tests/test_heat_calendar.js",
    why: "สัปดาห์ต้นปีกับปลายปีจะเด้งไปผิดแถว และคนละชุดกับที่ seasonal_stats ใช้",
    apply: () => write("app.js", read("app.js").replace(
      "    dt.setUTCDate(dt.getUTCDate() + 4 - dow); // เลื่อนไปวันพฤหัสฯ ของสัปดาห์นั้น\n", ""))
  },
  {
    id: "M13", name: "ส่วนต่างทั้งปีใช้ผลรวมแทนผลทบต้น",
    script: "tests/test_heat_calendar.js",
    why: "วิธีที่ง่ายกว่าและดูสมเหตุสมผล แต่ให้คนละคำตอบกับที่คนอ่านคิดถึง",
    apply: () => write("app.js", read("app.js").replace(
      "absTotal === null || benchTotal === null ? null : absTotal - benchTotal",
      "absTotal === null ? null : periods.reduce((acc, p) => { const c = cells[y] && cells[y][p]; return acc + (c && c.rel !== null && c.rel !== undefined ? c.rel : 0); }, 0)"))
  },
  {
    id: "M14", name: "ไม้บรรทัดสีใช้ค่าสูงสุดแทนเปอร์เซ็นไทล์ 90",
    script: "tests/test_heat_calendar.js",
    why: "เดือนเดียวที่ -16% จะทำให้อีกสามร้อยช่องซีดจนอ่านไม่ออก",
    apply: () => write("app.js", read("app.js").replace(
      "    return Math.max(v[idx], 0.5);", "    return Math.max(v[v.length - 1], 0.5);"))
  },
  {
    id: "M15", name: "สีไม่ขึ้นกับไม้บรรทัดของตาราง",
    script: "tests/test_heat_calendar.js",
    why: "ความหมายของสีจะเปลี่ยนไปตามตาราง ทำให้เทียบข้ามปีไม่ได้โดยไม่มีอะไรบอก",
    apply: () => write("app.js", read("app.js").replace(
      "    const t = Math.min(1, Math.abs(value) / scale);",
      "    const t = Math.min(1, Math.abs(value) / 100);"))
  },
  {
    id: "M16", name: "Export ออกเฉพาะโหมดที่อยู่บนจอ",
    script: "tests/test_heat_calendar.js",
    why: "ไฟล์ที่ออกไปแล้วย้อนกลับมาเลือกโหมดใหม่ไม่ได้ (เคาะไว้ว่าต้องออกทั้งสอง)",
    apply: () => write("app.js", read("app.js").replace(
      "      if (heatRelAvailable()) {", "      if (false) {"))
  },
  {
    id: "M11", name: "universe falls back to a list in the file",
    script: "tests/test_app.js",
    why: "the page would rank a different set of funds than the weekly brief, and nothing would say so",
    apply: () => write("app.js", read("app.js").replace(
      "if (!state.universes.loaded) {", "if (false) {"))
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
