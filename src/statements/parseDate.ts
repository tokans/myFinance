const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parses a bank/tax-statement date cell into 'YYYY-MM-DD'. Returns null if unrecognized. */
export function parseStatementDate(raw: string): string | null {
  const s = raw.trim();

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;

  // DD/MM/YY, DD-MM-YY
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2})$/);
  if (m) return `20${m[3]}-${pad(m[2])}-${pad(m[1])}`;

  // YYYY-MM-DD (already ISO)
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  // "01 Apr 2026" / "01-Apr-2026" / "01 April 2026"
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${pad(m[1])}`;
  }

  return null;
}

function pad(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

/**
 * Splits a leading date token off text that has trailing content glued onto
 * it with no more than a normal word-space gap — e.g. a PDF table cell where
 * the "date" and "description" columns weren't visually separated by a real
 * gutter, only ordinary inter-word spacing, so the geometric table
 * reconstruction merged them into one cell instead of two. Tries the same
 * date shapes `parseStatementDate` recognizes, but as a PREFIX rather than
 * requiring the whole string to be just a date. Returns the parsed
 * 'YYYY-MM-DD' date and whatever follows it (trimmed); a null date and the
 * original text unchanged if nothing at the start looks like a date.
 */
export function splitLeadingDate(raw: string): { date: string | null; rest: string } {
  const s = raw.trim();

  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b\s*/);
  if (m) return { date: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, rest: s.slice(m[0].length) };

  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2})\b\s*/);
  if (m) return { date: `20${m[3]}-${pad(m[2])}-${pad(m[1])}`, rest: s.slice(m[0].length) };

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b\s*/);
  if (m) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, rest: s.slice(m[0].length) };

  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})\b\s*/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return { date: `${m[3]}-${mon}-${pad(m[1])}`, rest: s.slice(m[0].length) };
  }

  return { date: null, rest: s };
}
