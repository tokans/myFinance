//! Native PDF parsing for bank-statement / tax-document import.
//!
//! Backed by `sharedCoreLib/pdf-lib` (PDFium-based text/table extraction, a
//! Docling-inspired geometric heuristic with no ML model and no Python runtime).
//! Chosen over bundling Docling itself: Docling is Python/PyTorch-only, has no
//! native Windows distribution (its `docling-serve` REST server ships only as a
//! Linux Docker image), and would require gigabytes of runtime + models just to
//! read a bank statement. PDFium's password handling covers the common
//! password-protected-PDF case (e.g. Indian bank/broker statements using a
//! PAN+DOB-derived password); the app supplies the candidate passwords to try.

use pdf_lib::{ExtractionTuning, PdfLibError, TableRow};
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct StatementPdfResult {
    pub rows: Vec<TableRow>,
    /// The candidate password that successfully opened the document, if any
    /// (`None` for an unprotected PDF) — surfaced so the caller can remember it.
    pub password_used: Option<String>,
}

fn resource_pdfium_dir(app: &AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .resolve("pdfium", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("could not resolve bundled PDFium resource dir: {e}"))?;

    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "PDFium resource path is not valid UTF-8".to_string())
}

/// Parses a PDF's tables. Tries `password_candidates` in order if the document is
/// encrypted; returns the sentinel string `"PASSWORD_REQUIRED"` as the error if none
/// match, so the frontend can distinguish "needs a password" from other failures and
/// prompt the user for a manual override (mirroring the AIS import flow's UX).
#[tauri::command]
pub fn parse_statement_pdf(
    app: AppHandle,
    bytes: Vec<u8>,
    password_candidates: Vec<String>,
) -> Result<StatementPdfResult, String> {
    let lib_dir = resource_pdfium_dir(&app)?;
    let pdfium = pdf_lib::bind_pdfium(&lib_dir).map_err(|e| e.to_string())?;

    let (doc, password_used) =
        pdf_lib::open_with_password_candidates(&pdfium, &bytes, &password_candidates).map_err(
            |e| match e {
                PdfLibError::PasswordRequired => "PASSWORD_REQUIRED".to_string(),
                other => other.to_string(),
            },
        )?;

    let rows =
        pdf_lib::extract_table(&doc, ExtractionTuning::default()).map_err(|e| e.to_string())?;

    Ok(StatementPdfResult { rows, password_used })
}

#[derive(Serialize)]
pub struct ArchiveEntryResult {
    /// The extracted entry's filename (e.g. "26AS.pdf") — the caller uses its
    /// extension to decide which parser to hand the bytes to next.
    pub filename: String,
    pub bytes: Vec<u8>,
    /// The candidate password that opened the archive, if any.
    pub password_used: Option<String>,
}

/// Extracts the single most relevant file from a (possibly password-protected)
/// zip archive — the common wire format for AIS/26AS/bank-statement "download
/// as zip" exports. Same `PASSWORD_REQUIRED` sentinel convention as `parse_statement_pdf`.
#[tauri::command]
pub fn extract_zip_entry(
    bytes: Vec<u8>,
    password_candidates: Vec<String>,
) -> Result<ArchiveEntryResult, String> {
    match pdf_lib::extract_zip_entry(&bytes, &password_candidates) {
        Ok((filename, bytes, password_used)) => Ok(ArchiveEntryResult { filename, bytes, password_used }),
        Err(PdfLibError::PasswordRequired) => Err("PASSWORD_REQUIRED".to_string()),
        Err(other) => Err(other.to_string()),
    }
}
