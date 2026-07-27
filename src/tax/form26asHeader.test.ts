import { describe, expect, it } from "vitest";
import { buildDocModel, fromNativeRows } from "@scandoc/core/docmodel";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";
import { extractForm26asHeader } from "./form26asHeader";
import type { PdfTableRow } from "@/statements/types";

function row(rowIndex: number, text: string): PdfTableRow {
  return { page_index: 0, row_index: rowIndex, cells: [{ text, x: 30, width: 500 }] };
}

function modelOf(rows: PdfTableRow[]) {
  return buildDocModel(
    { doc: fromNativeRows(rows), filename: "26AS.pdf", kind: "pdf" },
    { parseNumber: parseAmount, parseDate: parseStatementDate },
  );
}

describe("extractForm26asHeader", () => {
  it("reads PAN and a directly-stated Assessment Year", () => {
    const rows = [row(0, "Permanent Account Number (PAN) ABCPD1234E"), row(1, "Assessment Year 2026-27")];
    expect(extractForm26asHeader(modelOf(rows))).toEqual({ pan: "ABCPD1234E", assessmentYear: "2026-27" });
  });

  it("derives the Assessment Year from Financial Year when no direct AY label is present", () => {
    const rows = [row(0, "Financial Year 2025-26")];
    expect(extractForm26asHeader(modelOf(rows)).assessmentYear).toBe("2026-27");
  });

  it("prefers a direct Assessment Year label over deriving one from Financial Year", () => {
    const rows = [row(0, "Financial Year 2025-26 Assessment Year 2026-27")];
    expect(extractForm26asHeader(modelOf(rows)).assessmentYear).toBe("2026-27");
  });

  it("returns nulls (not a crash) when nothing matches", () => {
    expect(extractForm26asHeader(modelOf([row(0, "unrelated text")]))).toEqual({ pan: null, assessmentYear: null });
  });
});
