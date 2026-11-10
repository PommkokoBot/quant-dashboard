// Both files, since 2026-11-10: the app moved to app.js and most class names
// are built there inside template literals. Scanning only index.html would
// purge them from the build and the page would lose its styling silently.
module.exports = { content: ["./index.html", "./app.js"], theme: { extend: {} }, plugins: [] };
