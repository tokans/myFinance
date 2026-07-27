import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/environment";
import { DocumentPasswordRequiredError } from "sharedcorelib/docintake";
import type { ParseStatementPdfResult } from "./types";

/**
 * Calls the native `parse_statement_pdf` Tauri command (sharedCoreLib/pdf-lib,
 * PDFium-backed). Tries `passwordCandidates` in order if the PDF is encrypted.
 * Throws `DocumentPasswordRequiredError` when none of the candidates unlock it, so
 * callers can prompt for a manual password (mirroring the AIS import flow).
 */
export async function parseStatementPdf(
  bytes: Uint8Array,
  passwordCandidates: string[],
): Promise<ParseStatementPdfResult> {
  if (!isTauri()) {
    throw new Error("PDF statement import requires the desktop app (no SQLite/native PDF access in browser preview).");
  }
  try {
    // Sent as a plain JSON number array (Tauri deserializes into a Rust Vec<u8>).
    // Fine for typical statement sizes (KBs–low MBs); a raw-binary IPC path would
    // be worth it only if this ever needs to handle much larger files.
    return await invoke<ParseStatementPdfResult>("parse_statement_pdf", {
      bytes: Array.from(bytes),
      passwordCandidates,
    });
  } catch (err) {
    if (err === "PASSWORD_REQUIRED") throw new DocumentPasswordRequiredError();
    throw err;
  }
}
