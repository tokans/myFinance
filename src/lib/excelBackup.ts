/**
 * Excel backup/restore wiring (Settings → "Backup & restore").
 *
 * Thin glue over `sharedcorelib/backup` (subsystem #22). Post-consolidation (prompts/10,
 * decision 9) there is ONE database — the shared `suite.db` — so the backup is a SINGLE
 * full-suite source: it exports EVERY installed app's tables (one sheet per table,
 * `_meta`/`_tables`/`_schemas`), re-importable on another machine and restorable from any
 * suite app's workbook. Secret-tier / password-named fields export as one-way sha256
 * fingerprints and are skipped on import (core rule). Stronghold vault credentials are not
 * in SQLite and are never exported at all.
 */
import * as XLSX from "xlsx";
import {
  createExcelBackup, suiteSourceFull,
  type ExcelBackup, type XlsxModule, type BackupSource,
} from "sharedcorelib/backup";
import { loadRegistry } from "sharedcorelib/db";
import { openSharedDbAdapter } from "@/db/sharedDb";

const APP_ID = "myfinance";

/** Build the backup engine over the single suite DB. Tauri-only (suite DB throws in browser). */
export async function buildExcelBackup(): Promise<ExcelBackup> {
  // FULL suite dump: every installed app's tables in suite.db — any app's export is the
  // suite-wide data inventory + backup; suite sheets restore from any app's workbook.
  const suite = await openSharedDbAdapter();
  const sources: BackupSource[] = [suiteSourceFull(suite, await loadRegistry(suite))];
  return createExcelBackup({ appId: APP_ID, sources, xlsx: XLSX as unknown as XlsxModule });
}

/** Native save handler for `BackupPanel` (Tauri dialog + fs, like the Excel exporter). */
export async function saveBackupFile(bytes: Uint8Array, fileName: string): Promise<void> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const path = await save({
    defaultPath: fileName,
    filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
  });
  if (!path) throw new Error("Export cancelled — no file chosen.");
  await writeFile(path, bytes);
}
