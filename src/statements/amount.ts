/** Parses a bank-statement amount cell ("1,250.00", "₹1,250", "(500.00)" for a
 *  negative/reversal). Returns null if the cell isn't a plausible amount. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;

  const value = parseFloat(s);
  if (Number.isNaN(value)) return null;
  return negative ? -Math.abs(value) : value;
}
