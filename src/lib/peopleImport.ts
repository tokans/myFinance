import type { PersonInput } from "@/db/people";

/**
 * Map a raw spreadsheet (first sheet, `rows[0]` = header) into PersonInput rows.
 * Columns are matched by header keyword — deterministic, no LLM. A row is kept
 * only when it yields a non-empty name. Used by the People page's "Import from
 * Excel/CSV" action; the heavier per-asset import wizard stays in `src/excel/`.
 */
const NAME_HEADER = [/\bname\b/, /\bperson\b/, /full name/, /contact name/];
const PHONE_HEADER = [/\bphone\b/, /\bmobile\b/, /\bnumber\b/, /\btel\b/, /\bcontact\b/];
const EMAIL_HEADER = [/\bemail\b/, /\be-?mail\b/];
const REL_HEADER = [/relationship/, /\brelation\b/, /\brole\b/];

function cell(v: string | number | null | undefined): string {
  return v == null ? "" : String(v).trim();
}

/** Index of the first header cell matching any pattern, or -1. */
function matchCol(header: (string | number | null)[], patterns: RegExp[], exclude: number[] = []): number {
  for (let c = 0; c < header.length; c++) {
    if (exclude.includes(c)) continue;
    const h = cell(header[c]).toLowerCase();
    if (h && patterns.some((p) => p.test(h))) return c;
  }
  return -1;
}

export interface PeopleSheetMapping {
  nameCol: number;
  relCol: number;
  phoneCol: number;
  emailCol: number;
}

/** Resolve which columns hold which field. Name falls back to column 0. */
export function resolvePeopleColumns(header: (string | number | null)[]): PeopleSheetMapping {
  const nameCol = matchCol(header, NAME_HEADER);
  const emailCol = matchCol(header, EMAIL_HEADER);
  const relCol = matchCol(header, REL_HEADER, [nameCol, emailCol]);
  const phoneCol = matchCol(header, PHONE_HEADER, [nameCol, emailCol, relCol]);
  return { nameCol: nameCol === -1 ? 0 : nameCol, relCol, phoneCol, emailCol };
}

export function mapPeopleSheet(rows: (string | number | null)[][]): PersonInput[] {
  if (rows.length === 0) return [];
  const header = rows[0] ?? [];
  const { nameCol, relCol, phoneCol, emailCol } = resolvePeopleColumns(header);

  const out: PersonInput[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const name = cell(row[nameCol]);
    if (!name) continue;
    out.push({
      name,
      relationship: relCol >= 0 ? cell(row[relCol]) || null : null,
      phone: phoneCol >= 0 ? cell(row[phoneCol]) || null : null,
      email: emailCol >= 0 ? cell(row[emailCol]) || null : null,
      access_tier: 0,
    });
  }
  return out;
}
