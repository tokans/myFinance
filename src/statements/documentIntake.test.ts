import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("./pdfInvoke", () => ({
  parseStatementPdf: vi.fn(),
}));
vi.mock("./archiveInvoke", () => ({
  extractZipEntry: vi.fn(),
}));
vi.mock("@/lib/environment", () => ({
  isMobile: vi.fn().mockResolvedValue(false),
}));

import { extractZipEntry } from "./archiveInvoke";
import { openDocument, openProtectedDocument } from "./documentIntake";
import { isMobile } from "@/lib/environment";
import { parseStatementPdf } from "./pdfInvoke";
import { MobileUnsupportedError } from "./types";

// officecrypto-tool's agile encryption (PBKDF2) can exceed the default 5s
// timeout when the full suite runs many files in parallel under CPU
// contention — not a correctness issue, just needs more headroom.
vi.setConfig({ testTimeout: 20000 });

function makeEncryptedXlsx(password: string): Promise<Uint8Array> {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["Item", "Value"], ["Savings", 50000]]);
  XLSX.utils.book_append_sheet(wb, ws, "Apr-2026");
  const plain = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  return import("officecrypto-tool").then((mod) => {
    const m = mod as unknown as { default?: unknown; encrypt?: unknown };
    const lib = (typeof m.encrypt === "function" ? m : m.default) as {
      encrypt(input: Buffer, opts: { password: string }): Buffer;
    };
    return new Uint8Array(lib.encrypt(Buffer.from(plain), { password }));
  });
}

describe("openProtectedDocument", () => {
  beforeEach(() => {
    vi.mocked(parseStatementPdf).mockReset();
    vi.mocked(extractZipEntry).mockReset();
    vi.mocked(isMobile).mockReset().mockResolvedValue(false);
  });

  it("routes a password-protected xlsx through decrypt + readWorkbook", async () => {
    const encrypted = await makeEncryptedXlsx("realpw");

    const result = await openProtectedDocument(encrypted, "statement.xlsx", ["wrong", "realpw"]);

    expect(result.kind).toBe("workbook");
    if (result.kind === "workbook") {
      expect(result.sheets.map((s) => s.name)).toContain("Apr-2026");
      expect(result.passwordUsed).toBe("realpw");
    }
    expect(result.log.some((e) => e.stage === "detect")).toBe(true);
    expect(result.log.some((e) => e.stage === "workbook")).toBe(true);
  });

  it("routes a PDF straight to parseStatementPdf", async () => {
    vi.mocked(parseStatementPdf).mockResolvedValue({ rows: [], password_used: null });

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const result = await openProtectedDocument(bytes, "statement.pdf", []);

    expect(result.kind).toBe("pdf");
    expect(parseStatementPdf).toHaveBeenCalledOnce();
  });

  it("extracts a zip's inner PDF and re-routes it through the PDF path", async () => {
    vi.mocked(extractZipEntry).mockResolvedValue({
      filename: "26AS.pdf",
      bytes: [0x25, 0x50, 0x44, 0x46],
      password_used: "zippw",
    });
    vi.mocked(parseStatementPdf).mockResolvedValue({ rows: [], password_used: null });

    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK.."
    const result = await openProtectedDocument(bytes, "26AS.zip", ["guess1"]);

    expect(extractZipEntry).toHaveBeenCalledWith(bytes, ["guess1"]);
    expect(parseStatementPdf).toHaveBeenCalledWith(expect.any(Uint8Array), ["zippw", "guess1"]);
    expect(result.kind).toBe("pdf");
    expect(result.log.map((e) => e.stage)).toEqual(["detect", "zip", "zip", "detect", "pdf", "pdf"]);
  });

  it("throws a clear error for an unsupported file type", async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02]);
    await expect(openProtectedDocument(bytes, "mystery.dat", [])).rejects.toThrow(/Unsupported file type/);
  });

  it("blocks a PDF on mobile before ever calling the native parser", async () => {
    vi.mocked(isMobile).mockResolvedValue(true);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

    await expect(openProtectedDocument(bytes, "statement.pdf", [])).rejects.toThrow(MobileUnsupportedError);
    expect(parseStatementPdf).not.toHaveBeenCalled();
  });

  it("blocks a ZIP on mobile before ever calling the native extractor", async () => {
    vi.mocked(isMobile).mockResolvedValue(true);
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK.."

    await expect(openProtectedDocument(bytes, "26AS.zip", [])).rejects.toThrow(MobileUnsupportedError);
    expect(extractZipEntry).not.toHaveBeenCalled();
  });

  it("still routes a password-protected xlsx through pure-JS decryption on mobile", async () => {
    vi.mocked(isMobile).mockResolvedValue(true);
    const encrypted = await makeEncryptedXlsx("realpw");

    const result = await openProtectedDocument(encrypted, "statement.xlsx", ["realpw"]);

    expect(result.kind).toBe("workbook");
  });
});

describe("openDocument", () => {
  beforeEach(() => {
    vi.mocked(isMobile).mockResolvedValue(false);
  });

  it("structures a PDF extraction into a positionless DocModel", async () => {
    // Same intake, same document — but the geometry stops here instead of
    // reaching a domain parser.
    vi.mocked(parseStatementPdf).mockResolvedValue({
      password_used: null,
      rows: [
        { page_index: 0, row_index: 0, cells: [c("Date", 30), c("Narration", 90), c("Amount", 300)] },
        { page_index: 0, row_index: 1, cells: [c("01/04/2026", 30), c("SALARY CREDIT", 90), c("50000.00", 300)] },
      ],
    });

    const { model, positional } = await openDocument(pdfBytes(), "statement.pdf", []);

    const table = model.children.find((n) => n.kind === "table");
    expect(table).toBeDefined();
    if (table?.kind !== "table") throw new Error("expected a table");
    expect(table.headers).toEqual(["Date", "Narration", "Amount"]);
    expect(table.records[0].cells).toMatchObject({ Date: "01/04/2026", Amount: "50000.00" });

    // No coordinates survive into the model; the interim doc still has them
    // for the diagnostic dump.
    expect(JSON.stringify(model)).not.toContain('"x"');
    expect(positional.rows[0].cells[0].x).toBe(30);
  });

  it("reads a delimited text export, nesting by its leading empty field", async () => {
    vi.mocked(extractZipEntry).mockResolvedValue({
      filename: "26AS.txt",
      bytes: Array.from(
        new TextEncoder().encode(
          [
            "Sr. No.^Name of Deductor^Total Tax Deducted(Rs.)",
            "1^FIRST DEDUCTOR PVT LTD^4800.00",
            "^Sr. No.^Section^Transaction Date^Tax Deducted(Rs.)",
            "^1^192^30-Dec-2022^4800.00",
          ].join("\n"),
        ),
      ),
      password_used: "zippw",
    });

    const { model, passwordUsed } = await openDocument(zipBytes(), "26AS.zip", ["zippw"]);

    expect(passwordUsed).toBe("zippw");
    const outer = model.children.find((n) => n.kind === "table");
    if (outer?.kind !== "table") throw new Error("expected a table");
    expect(outer.records[0].cells["Name of Deductor"]).toBe("FIRST DEDUCTOR PVT LTD");
    // The deductor's per-transaction breakup nests under the deductor.
    expect(outer.records[0].children?.[0].kind).toBe("table");
  });

  it("surfaces the mobile message when a native seam is unavailable", async () => {
    vi.mocked(isMobile).mockResolvedValue(true);
    await expect(openDocument(pdfBytes(), "s.pdf", [])).rejects.toBeInstanceOf(MobileUnsupportedError);
  });
});

function c(text: string, x: number) {
  return { text, x, width: Math.max(text.length * 5, 12) };
}
function pdfBytes() {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
}
function zipBytes() {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
}
