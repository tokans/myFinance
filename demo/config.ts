/**
 * myFinance demo-rig config. The reusable engine lives in @mydemo/core; this
 * file is the app-specific injection point — identity, paths, the demo-mode
 * build flag, and the sample workbooks each import scenario uses.
 *
 * Scenarios import { SAMPLE } / { DIRS } from here; the edit EDL imports
 * { DIRS, VIDEO }. Everything else (launch, capture, encode, compose) is the
 * package's job.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { defineConfig } from "@mydemo/core";

const demoDir = dirname(fileURLToPath(import.meta.url));
/** Repo root (one level up from demo/). */
export const ROOT = resolve(demoDir, "..");

/** Resolved engine config, passed into every @mydemo/core call. */
export const config = defineConfig({
  rootDir: ROOT,
  demoDir,
  app: {
    // OS window title (ffmpeg gdigrab capture + focus), Tauri bundle id
    // (per-user app-data dir), cargo package name (debug binary file name).
    windowTitle: "myFinance",
    identifier: "com.myfinance.app",
    binName: "myfinance",
  },
  devUrl: "http://localhost:1420/",
  // Selector that proves the UI booted before we start capturing.
  navAnchor: "nav-dashboard",
  // Mirrors src/lib/demoMode.ts; the rig types this where a lock screen appears.
  masterPassword: "demo1234",
  window: { width: 1440, height: 900 },
  // `--demo` makes the Rust side force the 1440x900 window.
  driverArgs: ["--demo"],
  // The only place the demo flag is baked in (auto-unlock vault, fixed dialog
  // paths). VITE_DEMO_OUTPUT_DIR + TAURI_ENV_PLATFORM are injected by the engine.
  build: { frontendEnv: { VITE_DEMO_MODE: "1" } },
  // Wiped before each recording for a clean first-run.
  resetFiles: ["myfinance.db", "myfinance.db-wal", "myfinance.db-shm", "vault.stronghold"],
});

/** Convenience re-exports so scenarios / the EDL keep importing from one place. */
export const DIRS = config.dirs;
export const VIDEO = config.video;

/** Sample workbook for each import scenario, by scenario id. */
export const SAMPLE = {
  basic: join(DIRS.sampleData, "01-networth-basic.xlsx"),
  creditDebit: join(DIRS.sampleData, "02-cashflow-credit-debit.xlsx"),
  estate: join(DIRS.sampleData, "03-estate-readiness.xlsx"),
  multiColumn: join(DIRS.sampleData, "04-multi-column-assets.xlsx"),
  wizard: join(DIRS.sampleData, "05-needs-wizard.xlsx"),
  tutorial: join(DIRS.sampleData, "06-tutorial-complete.xlsx"),
} as const;
