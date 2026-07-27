/**
 * Generates candidate passwords for password-protected bank-statement and
 * tax-document PDFs (e.g. Indian bank e-statements, Form 26AS/AIS PDF exports),
 * which conventionally derive the PDF's own `/Encrypt` password from the
 * account holder's PAN, date of birth, name, or account number — a different
 * scheme from `tax/aisCrypto.ts`'s AES-CBC-over-JSON envelope (that decrypts
 * the AIS *Utility's* JSON export; this generates guesses for a PDF's
 * *native* password, tried via PDFium/zip in `pdf-lib`).
 *
 * Every pattern here is a best-effort guess against known conventions — this
 * list can't be exhaustive across every bank/employer/portal, so the caller
 * must always offer a manual password field as a fallback (separate from
 * these auto-generated guesses, never merged into them). See
 * `passwordPatternLearning.ts`: when a manually-entered password turns out to
 * be a combination of these same building blocks that isn't in the list
 * below, it's inferred and remembered so future documents try it too.
 */

export interface PdfPasswordInputs {
  /** 10-char PAN (both cases are tried). */
  pan?: string;
  /** Date of birth. Accepts DDMMYYYY / DD/MM/YYYY / DD-MM-YYYY / YYYY-MM-DD. */
  dob?: string;
  /** Account holder's full name — first 4 letters are a common password component. */
  name?: string;
  /** Full account number (last 4 digits are commonly used in password schemes). */
  accountNumber?: string;
  /** Bank customer/CIF ID (tried verbatim) — a common bank e-statement password component, stored per-account so it isn't retyped every import. */
  customerId?: string;
  /** Explicit password override — tried first, kept separate from the guessed patterns. */
  password?: string;
}

/** The building-block categories a password can be assembled from. `DOB`
 *  covers every date form (see `dobForms`) as one category — the *specific*
 *  form doesn't change the conceptual "shape" of a pattern. */
export type AtomCategory = "PAN_UPPER" | "PAN_LOWER" | "NAME4_UPPER" | "NAME4_LOWER" | "ACCOUNT_LAST4" | "CUSTOMER_ID" | "DOB";

/** Every DOB form seen in the wild across bank/tax-portal password schemes. */
function dobForms(dob: string): string[] {
  const d = dob.trim();
  let m: RegExpMatchArray | null;
  let dd: string | undefined, mm: string | undefined, yyyy: string | undefined;

  if ((m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [, yyyy, mm, dd] = m; // YYYY-MM-DD
  else if ((m = d.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/))) [, dd, mm, yyyy] = m; // DD/MM/YYYY
  else if (/^\d{8}$/.test(d)) { dd = d.slice(0, 2); mm = d.slice(2, 4); yyyy = d.slice(4); } // DDMMYYYY

  if (!dd || !mm || !yyyy) return [d]; // unrecognized — try it verbatim as a last resort

  const yy = yyyy.slice(2);
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthName = monthNames[parseInt(mm, 10) - 1];
  const ddmmm = monthName ? `${dd}${monthName}` : null;

  return Array.from(
    new Set(
      [
        `${dd}${mm}${yyyy}`, // DDMMYYYY
        `${dd}${mm}${yy}`, // DDMMYY
        `${yyyy}${mm}${dd}`, // YYYYMMDD
        ddmmm, // DDMmm (e.g. "15may")
        ddmmm ? ddmmm.toUpperCase() : null, // DDMMM (e.g. "15MAY")
      ].filter((s): s is string => !!s),
    ),
  );
}

export interface ResolvedInputs {
  panLower: string | null;
  panUpper: string | null;
  dobs: string[];
  name4Lower: string | null;
  name4Upper: string | null;
  last4Account: string | null;
  customerId: string | null;
}

export function resolveInputs(inputs: PdfPasswordInputs): ResolvedInputs {
  const name = inputs.name?.trim().replace(/[^a-zA-Z]/g, "");
  return {
    panLower: inputs.pan?.trim().toLowerCase() || null,
    panUpper: inputs.pan?.trim().toUpperCase() || null,
    dobs: inputs.dob ? dobForms(inputs.dob) : [],
    name4Lower: name && name.length >= 4 ? name.slice(0, 4).toLowerCase() : null,
    name4Upper: name && name.length >= 4 ? name.slice(0, 4).toUpperCase() : null,
    last4Account: inputs.accountNumber?.trim().replace(/\s+/g, "").slice(-4) || null,
    customerId: inputs.customerId?.trim().replace(/\s+/g, "") || null,
  };
}

/** Every resolved atom's value(s) keyed by category — the shared vocabulary
 *  both candidate generation and pattern-learning (`passwordPatternLearning.ts`)
 *  build on, so a "shape" means the same thing in both places. */
export function resolveAtoms(inputs: PdfPasswordInputs): Partial<Record<AtomCategory, string[]>> {
  const r = resolveInputs(inputs);
  const atoms: Partial<Record<AtomCategory, string[]>> = {};
  if (r.panUpper) atoms.PAN_UPPER = [r.panUpper];
  if (r.panLower) atoms.PAN_LOWER = [r.panLower];
  if (r.name4Upper) atoms.NAME4_UPPER = [r.name4Upper];
  if (r.name4Lower) atoms.NAME4_LOWER = [r.name4Lower];
  if (r.last4Account) atoms.ACCOUNT_LAST4 = [r.last4Account];
  if (r.customerId) atoms.CUSTOMER_ID = [r.customerId];
  if (r.dobs.length > 0) atoms.DOB = r.dobs;
  return atoms;
}

/**
 * The maintained list of password patterns, most-to-least common across
 * Indian bank/broker/tax-portal PDF conventions. Each entry is independently
 * reviewable/extendable — add a new convention here as one more row, not by
 * threading more logic through a single function. `shape` is the same
 * category list `passwordPatternLearning.ts` uses to recognize "this manually
 * entered password is already one of the patterns we try" vs. genuinely new.
 */
const PASSWORD_PATTERNS: { label: string; shape: AtomCategory[]; build: (r: ResolvedInputs) => string[] }[] = [
  { label: "PAN(upper) alone", shape: ["PAN_UPPER"], build: (r) => (r.panUpper ? [r.panUpper] : []) },
  { label: "PAN(lower) alone", shape: ["PAN_LOWER"], build: (r) => (r.panLower ? [r.panLower] : []) },
  { label: "PAN(lower)+DOB", shape: ["PAN_LOWER", "DOB"], build: (r) => (r.panLower ? r.dobs.map((d) => `${r.panLower}${d}`) : []) },
  { label: "PAN(upper)+DOB", shape: ["PAN_UPPER", "DOB"], build: (r) => (r.panUpper ? r.dobs.map((d) => `${r.panUpper}${d}`) : []) },
  { label: "DOB+PAN(upper)", shape: ["DOB", "PAN_UPPER"], build: (r) => (r.panUpper ? r.dobs.map((d) => `${d}${r.panUpper}`) : []) },
  { label: "DOB alone", shape: ["DOB"], build: (r) => r.dobs },
  { label: "Name4(upper)+DOB", shape: ["NAME4_UPPER", "DOB"], build: (r) => (r.name4Upper ? r.dobs.map((d) => `${r.name4Upper}${d}`) : []) },
  { label: "Name4(lower)+DOB", shape: ["NAME4_LOWER", "DOB"], build: (r) => (r.name4Lower ? r.dobs.map((d) => `${r.name4Lower}${d}`) : []) },
  { label: "DOB+Name4(upper)", shape: ["DOB", "NAME4_UPPER"], build: (r) => (r.name4Upper ? r.dobs.map((d) => `${d}${r.name4Upper}`) : []) },
  { label: "PAN(lower)+Name4(upper)", shape: ["PAN_LOWER", "NAME4_UPPER"], build: (r) => (r.panLower && r.name4Upper ? [`${r.panLower}${r.name4Upper}`] : []) },
  { label: "AccountLast4+DOB", shape: ["ACCOUNT_LAST4", "DOB"], build: (r) => (r.last4Account ? r.dobs.map((d) => `${r.last4Account}${d}`) : []) },
  { label: "DOB+AccountLast4", shape: ["DOB", "ACCOUNT_LAST4"], build: (r) => (r.last4Account ? r.dobs.map((d) => `${d}${r.last4Account}`) : []) },
  { label: "Name4(upper)+AccountLast4", shape: ["NAME4_UPPER", "ACCOUNT_LAST4"], build: (r) => (r.name4Upper && r.last4Account ? [`${r.name4Upper}${r.last4Account}`] : []) },
  { label: "CustomerID alone", shape: ["CUSTOMER_ID"], build: (r) => (r.customerId ? [r.customerId] : []) },
  { label: "CustomerID+DOB", shape: ["CUSTOMER_ID", "DOB"], build: (r) => (r.customerId ? r.dobs.map((d) => `${r.customerId}${d}`) : []) },
  { label: "DOB+CustomerID", shape: ["DOB", "CUSTOMER_ID"], build: (r) => (r.customerId ? r.dobs.map((d) => `${d}${r.customerId}`) : []) },
];

/** Canonical string key for a shape (order matters) — used to de-dupe/compare
 *  against learned shapes without caring about the concrete DOB sub-form. */
export function shapeKey(shape: AtomCategory[]): string {
  return shape.join("+");
}

/** Every shape this module already tries — anything else inferred from a
 *  manually-entered password counts as newly learned. */
export const KNOWN_SHAPES: ReadonlySet<string> = new Set(PASSWORD_PATTERNS.map((p) => shapeKey(p.shape)));

/** Candidate passwords in pattern-list order. Not exhaustive — always pair
 *  with a manual-password fallback in the UI. */
export function pdfPasswordCandidates(inputs: PdfPasswordInputs): string[] {
  const list: string[] = [];
  if (inputs.password && inputs.password.trim()) list.push(inputs.password.trim());

  const resolved = resolveInputs(inputs);
  for (const pattern of PASSWORD_PATTERNS) list.push(...pattern.build(resolved));

  return Array.from(new Set(list.filter((s) => s.length > 0)));
}
