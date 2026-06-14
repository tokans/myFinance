/** @type {import('tailwindcss').Config} */
// Suite-shared theme via the core preset (token→var mapping, dark mode, animate plugin) —
// see sharedCoreLib/CONTRACT.md §4.2. The content globs MUST include the shared UI source so
// the shared primitives' (`SuiteShell`/`Sheet`) Tailwind classes compile instead of being purged.
const preset = require("sharedcorelib/tailwind-preset");

module.exports = {
  presets: [preset],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../sharedCoreLib/src/ui/**/*.{ts,tsx}",
  ],
  // App-specific brand TOKEN VALUES are overridden in src/index.css (not here); add any
  // app-only Tailwind extensions under theme.extend below — they merge over the preset.
};
