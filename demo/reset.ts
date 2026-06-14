/**
 * Wipe the app's local state so every recording starts from a clean first-run.
 *
 *   npx tsx demo/reset.ts        (or: npm run demo:reset)
 */
import { resetAppData } from "@mydemo/core";
import { config } from "./config.ts";

await resetAppData(config);
