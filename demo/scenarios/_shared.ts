/**
 * Helpers shared across scenarios. Kept tiny and explicit — each step mirrors a
 * real user action so it reads the same whether on- or off-camera.
 */
import type { Helpers } from "./types.ts";

/**
 * Run the Import wizard happy-path for a default-schema workbook: open Import,
 * pick the file, preview, commit, land on the "done" state. Used both as the
 * on-camera flow (scenarios 01–04, pass a `pace`) and for off-camera seeding
 * (setup(), default pace 0 = as fast as the app allows).
 */
export async function importSample(h: Helpers, absPath: string, pace = 0): Promise<void> {
  const beat = () => h.pause(pace);
  await h.goto("/import");
  await h.waitFor("import-dropzone");
  await beat();
  await h.uploadFile("import-file-input", absPath);
  await h.waitFor("import-preview-button");
  await beat();
  await h.click("import-preview-button");
  await h.waitFor("import-commit-button");
  await beat();
  await h.click("import-commit-button");
  await h.waitFor("import-done");
  await beat();
}
