import * as XLSX from "xlsx";
import { listAccounts } from "@/db/accounts";
import { listMonths, listSnapshotsForMonth } from "@/db/snapshots";

/**
 * Build a workbook with one sheet per month (newest first).
 * Each sheet: col A = account name, col B = value.
 */
export async function buildExportWorkbook(): Promise<{ data: Uint8Array; sheetCount: number; rowCount: number }> {
  const accounts = await listAccounts({ includeArchived: true });
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const months = await listMonths();

  const wb = XLSX.utils.book_new();
  let rowCount = 0;

  for (const month of months) {
    const snaps = await listSnapshotsForMonth(month);
    const rows: (string | number)[][] = [["Item", "Value"]];
    for (const s of snaps) {
      const acc = accountById.get(s.account_id);
      rows.push([acc?.name ?? `Account #${s.account_id}`, s.value]);
      rowCount += 1;
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Column widths
    ws["!cols"] = [{ wch: 32 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, month);
  }

  if (months.length === 0) {
    // Always produce at least one sheet so the file is valid.
    const ws = XLSX.utils.aoa_to_sheet([["Item", "Value"]]);
    XLSX.utils.book_append_sheet(wb, ws, "empty");
  }

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  const bytes = out instanceof Uint8Array ? out : new Uint8Array(out);
  return { data: bytes, sheetCount: months.length, rowCount };
}

const DEFAULT_NAME_FMT = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
export function defaultFilename(): string {
  return `myFinance-export-${DEFAULT_NAME_FMT.format(new Date())}.xlsx`;
}
