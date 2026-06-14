/**
 * Demo-capture mode — dev tooling only, never a product feature.
 *
 * Enabled by building/serving the frontend with `VITE_DEMO_MODE=1`. The demo
 * recording rig under `demo/` sets this so scenarios run unattended:
 *   - the credential vault auto-unlocks with the demo master password
 *   - native save/open dialogs resolve to fixed paths under `demo/output/`
 *
 * Gating: this is true ONLY when the bundle was explicitly built with the env
 * flag set. A normal `npm run build` / `tauri build` never sets it, so
 * production installers are unaffected. Every consumer must read DEMO_MODE
 * (not the env var directly) so the gate lives in exactly one place.
 */
export const DEMO_MODE: boolean = import.meta.env.VITE_DEMO_MODE === "1";

/**
 * The master password the rig types / auto-fills. Mirrors demo/config.ts.
 * Gated on DEMO_MODE so the literal constant-folds away (to "") in normal
 * builds — the string never ends up in a shipped bundle.
 */
export const DEMO_MASTER_PASSWORD = DEMO_MODE ? "demo1234" : "";

/**
 * In demo mode, native save dialogs are skipped so scenarios run unattended:
 * callers write `filename` directly under the app-data dir (`BaseDirectory.AppData`,
 * which `capabilities/default.json` allows for fs writes) instead of prompting.
 * Returns the bare filename to write, or null when not in demo mode — callers
 * then fall back to the normal save-dialog flow.
 *
 * The recording rig never reads these files (the GIFs come from ffmpeg); the
 * write only has to *succeed* for the export/template flow to complete. Writing
 * to an absolute repo path (the old behaviour) is rejected by the fs scope, so
 * the export would silently fail — hence the app-data target.
 */
export function demoSaveName(filename: string): string | null {
  return DEMO_MODE ? filename : null;
}
