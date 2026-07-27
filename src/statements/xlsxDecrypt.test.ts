import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { decryptWorkbookBytes, decryptWorkbookWithCandidates, isEncryptedWorkbook } from "./xlsxDecrypt";
import { DocumentPasswordRequiredError } from "./types";

// officecrypto-tool's agile encryption runs PBKDF2 with many iterations —
// comfortably fast in isolation, but can exceed the default 5s timeout when
// the full suite runs many files in parallel and CPU is contended. Not a
// correctness issue — just needs more headroom under load.
vi.setConfig({ testTimeout: 20000 });

function makePlainWorkbookBytes(bookType: "xlsx" | "biff8" = "xlsx"): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Item", "Value"],
    ["Savings", 50000],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Apr-2026");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType }));
}

async function encryptWithPassword(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const mod = (await import("officecrypto-tool")) as unknown as { default?: unknown; encrypt?: unknown };
  const lib = (typeof mod.encrypt === "function" ? mod : mod.default) as {
    encrypt(input: Buffer, opts: { password: string }): Buffer;
  };
  return new Uint8Array(lib.encrypt(Buffer.from(bytes), { password }));
}

describe("isEncryptedWorkbook", () => {
  it("is false for a plain xlsx", async () => {
    expect(await isEncryptedWorkbook(makePlainWorkbookBytes())).toBe(false);
  });

  it("is true for a password-protected xlsx", async () => {
    const encrypted = await encryptWithPassword(makePlainWorkbookBytes(), "secret123");
    expect(await isEncryptedWorkbook(encrypted)).toBe(true);
  });

  it("is false for a plain legacy .xls (also an OLE/CFB container, but not encrypted)", async () => {
    // Regression test: a bare CFB-signature check (as used elsewhere for a
    // narrower xlsx-only case) would wrongly flag this as password-protected.
    expect(await isEncryptedWorkbook(makePlainWorkbookBytes("biff8"))).toBe(false);
  });
});

describe("decryptWorkbookBytes", () => {
  it("round-trips: encrypt then decrypt yields a workbook SheetJS can read", async () => {
    const plain = makePlainWorkbookBytes();
    const encrypted = await encryptWithPassword(plain, "secret123");

    const decrypted = await decryptWorkbookBytes(encrypted, "secret123");

    const wb = XLSX.read(decrypted, { type: "array" });
    expect(wb.SheetNames).toContain("Apr-2026");
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Apr-2026"], { header: 1 }) as unknown[][];
    expect(rows[1]).toEqual(["Savings", 50000]);
  });

  it("rejects a wrong password", async () => {
    const encrypted = await encryptWithPassword(makePlainWorkbookBytes(), "secret123");
    await expect(decryptWorkbookBytes(encrypted, "wrong-password")).rejects.toThrow();
  });
});

describe("decryptWorkbookWithCandidates", () => {
  it("passes plain workbook bytes through unchanged", async () => {
    const plain = makePlainWorkbookBytes();
    const result = await decryptWorkbookWithCandidates(plain, ["irrelevant"]);
    expect(result.passwordUsed).toBeNull();
    expect(result.bytes).toBe(plain);
  });

  it("finds the working password among several candidates", async () => {
    const encrypted = await encryptWithPassword(makePlainWorkbookBytes(), "realpw");
    const result = await decryptWorkbookWithCandidates(encrypted, ["wrong1", "wrong2", "realpw"]);
    expect(result.passwordUsed).toBe("realpw");
    expect(XLSX.read(result.bytes, { type: "array" }).SheetNames).toContain("Apr-2026");
  });

  it("throws DocumentPasswordRequiredError when no candidate matches", async () => {
    const encrypted = await encryptWithPassword(makePlainWorkbookBytes(), "realpw");
    await expect(decryptWorkbookWithCandidates(encrypted, ["wrong1", "wrong2"])).rejects.toThrow(
      DocumentPasswordRequiredError,
    );
  });
});
