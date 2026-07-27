export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const MONTH_LABEL_FMT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long" });

export function formatMonthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  if (!y || !m) return yyyyMm;
  return MONTH_LABEL_FMT.format(new Date(y, m - 1, 1));
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Compact, axis-friendly currency label using the Indian K/L/Cr scale
 * (thousand / lakh / crore). Used for chart axis ticks where the full
 * `formatMoney` string would be too wide.
 */
export function compactCurrency(value: number, currency: string): string {
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `${currency} ${(value / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${currency} ${(value / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${currency} ${(value / 1_000).toFixed(1)}K`;
  return `${currency} ${value.toFixed(0)}`;
}

/** Today as a local 'YYYY-MM-DD' string. Re-exported from the shared core (`sharedcorelib/reminders`). */
export { localToday as todayISO } from "sharedcorelib/reminders";

/** A transaction row's date for display: the parsed date, else the raw statement
 *  text, else an explicit placeholder — never a blank string (a row whose date
 *  column genuinely didn't parse would otherwise render nothing at all). */
export function transactionDateLabel(t: { date: string | null; raw_date: string }): string {
  return t.date ?? (t.raw_date.trim() || "Unknown date");
}
