/**
 * Video render entry point — composes a finished video from a named EDL.
 *
 *   npm run demo:video:marketing      # → demo/output/video/marketing.mp4
 *   npm run demo:video -- marketing   # same, explicit name
 *
 * Recomposes from the existing per-scenario MP4s in demo/output/; it never
 * launches the app or re-records. Edit the EDL and re-run to iterate.
 */
import { compose, type VideoEdl } from "@mydemo/core";
import { config } from "../config.ts";

const EDLS: Record<string, () => Promise<VideoEdl>> = {
  marketing: async () => (await import("./marketing.edl.ts")).default,
};

async function main(): Promise<void> {
  const name = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "marketing";
  const loader = EDLS[name];
  if (!loader) {
    console.error(`Unknown EDL "${name}". Known: ${Object.keys(EDLS).join(", ")}`);
    process.exit(1);
  }
  const edl = await loader();
  await compose(config, edl);
}

main().catch((e) => {
  console.error("\n✖ Render failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
