/**
 * Form 16's header/metadata (certificate number, employer/employee PAN, TAN,
 * assessment year, employer name).
 *
 * Most of it comes from the clean single-line summary Form 16 repeats at the
 * top of every page after the first ("Certificate Number: ABCDEFG TAN of
 * Employer: MUMA00001A PAN of Employee: AAAPA0000A Assessment Year:
 * 2026-27"). That line is far more reliable than the first page's own
 * two-column employer|employee block. The employer's own PAN and name aren't
 * in it, so they fall back to label matching on the first page, best-effort,
 * degrading to null rather than risking a wrong guess.
 *
 * The employer NAME used to be resolved geometrically — "whichever cell a few
 * rows below the label sits at the same x". It no longer needs to be: by the
 * time the document is a `DocModel`, the two columns are already two columns,
 * so the name is simply the first cell of the row below the label's row. Same
 * five real-world layouts, no coordinates.
 */
import { rowCells, textLines, type DocModel } from "@scandoc/core/docmodel";

const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const TAN_PATTERN = /\b[A-Z]{4}\d{5}[A-Z]\b/;

const CERT_NUMBER = /certificate\s*number\s*:\s*(\S+)/i;
const TAN_OF_EMPLOYER = /tan\s*of\s*employer\s*:\s*(\S+)/i;
const PAN_OF_EMPLOYEE = /pan\s*of\s*employee\s*:\s*(\S+)/i;
const ASSESSMENT_YEAR = /assessment\s*year\s*:\s*([\d-]+)/i;
// Guards against a real observed failure: the repeated per-page line is
// occasionally missing its own certificate-number value (page text simply
// jumps straight to the next label), which would otherwise capture "TAN" as
// if it were the certificate number.
const LOOKS_LIKE_ANOTHER_FIELD_LABEL = /^(tan|pan|assessment)$/i;

const EMPLOYER_LABEL =
  /\bname\s+and\s+address\s+of\s+the\s+employer(\s*\/\s*specified\s+bank)?\b|\bname\s+of\s+the\s+employer\b/i;
// A merged/garbled header cell can leave another field's OWN label behind
// after stripping the employer label (seen in a real parse: the employer and
// employee header cells merged into one blob, so stripping the employer label
// left the employee column's own label text behind, not a real value).
const LOOKS_LIKE_ANOTHER_LABEL = /\bemployee\b|\bdeductor\b|\btan\b|\bpan\b/i;
/** How many rows below the label to keep looking for its value. */
const EMPLOYER_LOOKAHEAD_ROWS = 5;

export interface Form16Header {
  certificateNumber: string | null;
  employerName: string | null;
  employerPan: string | null;
  tan: string | null;
  employeePan: string | null;
  assessmentYear: string | null;
}

function strip(text: string): string {
  return text.replace(EMPLOYER_LABEL, "").replace(/^[\s:\-]+/, "").trim();
}

/**
 * Finds the employer's name relative to its label.
 *
 * Three layouts, all real:
 *  - label and value inline in one cell ("Name of the Employer: ACME Ltd");
 *  - label alone in its column, value in the SAME column a row or two below,
 *    with the employee's details filling the neighbouring column — which is
 *    why this reads each row's FIRST cell rather than its joined text: joined,
 *    the two columns read "Employer-label Employee-label" and then
 *    "EmployerName EmployeeName";
 *  - label merged with the employee column's label into one blob, where
 *    stripping the employer label leaves another label behind and the honest
 *    answer is null.
 */
function findEmployerName(rows: string[][]): string | null {
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i][0] ?? "";
    if (!EMPLOYER_LABEL.test(first)) continue;

    const inline = strip(first);
    if (inline.length > 0) return LOOKS_LIKE_ANOTHER_LABEL.test(inline) ? null : inline;

    // Label-only cell: the value is below it, in this same column.
    const limit = Math.min(rows.length, i + 1 + EMPLOYER_LOOKAHEAD_ROWS);
    for (let j = i + 1; j < limit; j++) {
      const candidate = (rows[j][0] ?? "").trim();
      if (!candidate) continue;
      // Running into another field's label means the name block was absent —
      // return null rather than adopting whatever came next.
      if (EMPLOYER_LABEL.test(candidate) || LOOKS_LIKE_ANOTHER_LABEL.test(candidate)) return null;
      return candidate;
    }
    return null;
  }
  return null;
}

export function extractForm16Header(model: DocModel): Form16Header {
  let certificateNumber: string | null = null;
  let tan: string | null = null;
  let employeePan: string | null = null;
  let assessmentYear: string | null = null;
  const allPans: string[] = [];

  for (const text of textLines(model)) {
    if (!certificateNumber) {
      const m = CERT_NUMBER.exec(text)?.[1];
      if (m && !LOOKS_LIKE_ANOTHER_FIELD_LABEL.test(m)) certificateNumber = m;
    }
    if (!tan) tan = TAN_OF_EMPLOYER.exec(text)?.[1] ?? TAN_PATTERN.exec(text)?.[0] ?? null;
    if (!employeePan) employeePan = PAN_OF_EMPLOYEE.exec(text)?.[1] ?? null;
    if (!assessmentYear) assessmentYear = ASSESSMENT_YEAR.exec(text)?.[1] ?? null;

    for (const m of text.matchAll(PAN_PATTERN)) allPans.push(m[0]);
  }

  return {
    certificateNumber,
    employerName: findEmployerName(rowCells(model)),
    employerPan: allPans.find((p) => p !== employeePan) ?? null,
    tan,
    employeePan,
    assessmentYear,
  };
}
