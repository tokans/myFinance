import * as XLSX from "xlsx";

/**
 * Build a tiny example workbook in the default schema so the user can paste
 * their data into it and re-upload without any wizard questions.
 *
 * Layout per sheet:
 *   Row 1: header "Item | Value"
 *   Rows 2..N: data
 *   Row N+1: "Total | =SUM(B2:Bn)"   ← formula included so future auto-detection works
 */
export function buildTemplateWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const months = recentMonths(3);

  for (const month of months) {
    const aoa: (string | number)[][] = [
      ["Item", "Value"],
      ["HDFC Savings", 50000],
      ["ICICI Salary",  30000],
      ["Equity MF",     250000],
      ["EPF",           180000],
      ["Total",         0],   // value overwritten by formula below
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 16 }];
    // Replace the Total cell with a real SUM formula so future imports auto-detect it.
    const totalRowIdx = aoa.length;        // 1-indexed in A1 terms = aoa.length
    const sumRange = `B2:B${totalRowIdx - 1}`;
    const totalCell = `B${totalRowIdx}`;
    ws[totalCell] = { t: "n", f: `SUM(${sumRange})` };
    XLSX.utils.book_append_sheet(wb, ws, month);
  }

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

function recentMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function defaultTemplateFilename(): string {
  return "myFinance-template.xlsx";
}
