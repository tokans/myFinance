/**
 * Demo recorder entry — wires this app's config + scenario registry into the
 * @mydemo/core recorder CLI. The engine (launch, capture, encode, isolated
 * per-scenario processes) lives in the package.
 *
 *   npm run demo:single -- 01-basic-import     # record one scenario
 *   npm run demo:all                            # record every scenario
 *   npm run demo:gifs                           # re-encode existing MP4s → GIF
 *   npm run demo:single -- 01-basic-import --build   # force rebuild first
 */
import { fileURLToPath } from "node:url";
import { runRecorderCli } from "@mydemo/core";
import { config } from "./config.ts";
import { SCENARIOS } from "./scenarios/index.ts";

runRecorderCli({
  cfg: config,
  scenarios: SCENARIOS,
  entryScript: fileURLToPath(import.meta.url),
  argv: process.argv.slice(2),
}).catch((e) => {
  console.error("\n✖ Recording failed:", e);
  process.exit(1);
});
