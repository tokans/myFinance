/**
 * Tutorial render entry — captions + scores the single-take tutorial recording
 * (demo/output/20-full-tutorial.mp4 + its .timeline.json) into tutorial.mp4.
 * The renderer lives in @mydemo/core; this just supplies config + the id.
 *
 *   npm run demo:video:tutorial
 */
import { renderTutorial } from "@mydemo/core";
import { config } from "../config.ts";

renderTutorial(config, "20-full-tutorial").catch((e) => {
  console.error("\n✖ Tutorial render failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
