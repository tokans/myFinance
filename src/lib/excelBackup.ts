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
 *
 * The build + native-save mechanisms now live in the shared core (`buildSuiteBackup` +
 * `saveBackupBytes`); this file just binds them to myFinance's app id + DB adapter.
 */
import { buildSuiteBackup, saveBackupBytes, type ExcelBackup } from "sharedcorelib/backup";
import { openSharedDbAdapter } from "@/db/sharedDb";

const APP_ID = "myfinance";

/** Build the backup engine over the single suite DB. Tauri-only (suite DB throws in browser). */
export function buildExcelBackup(): Promise<ExcelBackup> {
  return buildSuiteBackup({ appId: APP_ID, openDb: openSharedDbAdapter });
}

/** Native save handler for `BackupPanel` (Tauri dialog + fs). */
export const saveBackupFile = saveBackupBytes;
