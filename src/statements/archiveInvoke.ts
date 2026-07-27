import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/environment";
import { DocumentPasswordRequiredError } from "sharedcorelib/docintake";

export interface ArchiveEntryResult {
  filename: string;
  bytes: number[];
  password_used: string | null;
}

/** Calls the native `extract_zip_entry` Tauri command (sharedCoreLib/pdf-lib) to
 *  pull the single most relevant file out of a (possibly password-protected)
 *  zip archive — the common wire format for AIS/26AS/bank-statement "download
 *  as zip" exports. Throws `DocumentPasswordRequiredError` when none of the
 *  candidates unlock it. */
export async function extractZipEntry(
  bytes: Uint8Array,
  passwordCandidates: string[],
): Promise<ArchiveEntryResult> {
  if (!isTauri()) {
    throw new Error("Zip import requires the desktop app (no native zip access in browser preview).");
  }
  try {
    return await invoke<ArchiveEntryResult>("extract_zip_entry", {
      bytes: Array.from(bytes),
      passwordCandidates,
    });
  } catch (err) {
    if (err === "PASSWORD_REQUIRED") throw new DocumentPasswordRequiredError();
    throw err;
  }
}
