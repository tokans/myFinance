/**
 * Force a fresh demo build: frontend (demo mode) + debug native binary.
 * Run after changing components/selectors so the recorded UI is current.
 *
 *   npm run demo:build
 */
import { ensureBuilt } from "@mydemo/core";
import { config } from "./config.ts";

await ensureBuilt(config, true);
console.log("✔ demo build complete");
