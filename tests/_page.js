// The single place that knows how a test assembles the page.
//
// Until 2026-11-10 the application code lived inside index.html, so a suite
// could read the file, drop the <script src=...> tags for the vendor libraries
// it mocks anyway, and hand the result to jsdom -- the app ran because it was
// part of the document. The code now lives in app.js, which jsdom does not
// fetch when it is given an HTML string, so the app has to be put back in
// deliberately.
//
// That is a few lines of fiddly logic -- keep app.js, drop the vendor tags,
// splice the source in at the position its tag occupied -- and it was about to
// be copied into eight suites. The day the page gains a second script file
// (the /brief/ page is already planned), seven copies would be updated and one
// forgotten. The forgotten one would not go red: it would still assemble *a*
// page successfully, just not the page that ships, and it would keep reporting
// green while guarding nothing. A suite that is green while testing something
// that no longer exists is worse than no suite at all.
//
// So the rule the rest of this project already applies to prices (ohlcv_adj),
// to period boundaries (period_end_closes) and to notifications (notify.py)
// applies here too: one definition, in one place.

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DEFAULT_PAGE = "../index.html";

// QD_HTML / QD_HTML_BEFORE let the before/after checks point at another build.
// Paths stay relative to tests/ exactly as they were before this file existed.
function pageFile(file) {
  const p = file || process.env.QD_HTML || DEFAULT_PAGE;
  return path.isAbsolute(p) ? p : path.resolve(__dirname, p);
}

function readPage(file) {
  return fs.readFileSync(pageFile(file), "utf8");
}

// The page as jsdom should see it: vendor libraries removed (every suite mocks
// Chart.js, Supabase and SheetJS itself), app.js inlined where its tag sits so
// it runs in the same position the browser would run it.
//
// A page that still carries its code inline -- the pre-2026-11-10 index.html
// that a before/after check may be pointed at -- has no app.js tag, so nothing
// is spliced and it keeps working unchanged.
function assemble(file) {
  const dir = path.dirname(pageFile(file));
  let inlined = false;

  const html = readPage(file).replace(
    /<script\b[^>]*\bsrc=["']?([^"'\s>]+)["']?[^>]*><\/script>/g,
    (_tag, src) => {
      if (!/(^|\/)app\.js$/.test(src)) return ""; // vendor: mocked, never loaded
      const source = fs.readFileSync(path.join(dir, src), "utf8");
      // The source was an inline block until today, so it provably contains no
      // closing tag. If that ever changes, fail loudly rather than produce a
      // page that is silently truncated at the wrong byte.
      if (source.includes("</script")) {
        throw new Error("app.js contains '</script' and can no longer be inlined for jsdom");
      }
      inlined = true;
      return "<script>" + source + "</script>";
    }
  );

  if (!inlined && !/<script>/.test(html)) {
    throw new Error("the assembled page carries no application code at all: " + pageFile(file));
  }
  return html;
}

// Options are passed straight through to jsdom, so a suite that needs
// something different still controls its own setup; only the assembling of the
// page and the two settings every suite shares live here.
function loadPage(opts = {}) {
  const { file, beforeParse, ...rest } = opts;
  return new JSDOM(assemble(file), {
    runScripts: "dangerously",
    url: "http://localhost/",
    beforeParse(window) {
      window.__QD_TEST__ = true; // stop the page initialising itself; the suite controls timing
      if (beforeParse) beforeParse(window);
    },
    ...rest
  });
}

module.exports = { loadPage, assemble, readPage, pageFile };
