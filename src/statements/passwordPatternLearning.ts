/**
 * Learns new password patterns from successful manual entries.
 *
 * `passwordCandidates.ts` ships a hand-curated list of known password
 * "shapes" (PAN+DOB, name+account-number, ...). When a user types a password
 * manually and it works, this checks whether that password is actually just
 * a combination of the SAME building blocks (PAN/DOB/name/account number) in
 * a shape that isn't in the known list yet — e.g. the PDF's password turns
 * out to be simply the PAN by itself, or the account holder's name plus the
 * last 4 digits of the account number. If so, the *shape* (not the literal
 * password — that generalizes to nothing else) is remembered, so the next
 * document from any source tries that combination automatically too.
 */
import { getSetting, setSetting } from "@/db/settings";
import { KNOWN_SHAPES, resolveAtoms, shapeKey, type AtomCategory, type PdfPasswordInputs } from "./passwordCandidates";

const LEARNED_SHAPES_SETTING_KEY = "password_learned_pattern_shapes";

const CATEGORY_LABELS: Record<AtomCategory, string> = {
  PAN_UPPER: "PAN (upper case)",
  PAN_LOWER: "PAN (lower case)",
  NAME4_UPPER: "name, first 4 letters (upper case)",
  NAME4_LOWER: "name, first 4 letters (lower case)",
  ACCOUNT_LAST4: "account number, last 4 digits",
  CUSTOMER_ID: "customer ID",
  DOB: "date of birth",
};

/** Human-readable description of a shape, e.g. "name, first 4 letters (upper case) + account number, last 4 digits". */
export function describeShape(shape: AtomCategory[]): string {
  return shape.map((c) => CATEGORY_LABELS[c]).join(" + ");
}

function parseShapeKey(key: string): AtomCategory[] {
  return key.split("+") as AtomCategory[];
}

export async function getLearnedShapes(): Promise<AtomCategory[][]> {
  const raw = await getSetting(LEARNED_SHAPES_SETTING_KEY);
  if (!raw) return [];
  try {
    const keys = JSON.parse(raw) as string[];
    return Array.isArray(keys) ? keys.map(parseShapeKey) : [];
  } catch {
    return [];
  }
}

async function addLearnedShape(shape: AtomCategory[]): Promise<void> {
  const existing = await getLearnedShapes();
  const key = shapeKey(shape);
  if (existing.some((s) => shapeKey(s) === key)) return;
  await setSetting(LEARNED_SHAPES_SETTING_KEY, JSON.stringify([...existing.map(shapeKey), key]));
}

async function isKnownShape(shape: AtomCategory[]): Promise<boolean> {
  if (KNOWN_SHAPES.has(shapeKey(shape))) return true;
  const learned = await getLearnedShapes();
  return learned.some((s) => shapeKey(s) === shapeKey(shape));
}

/**
 * Tries to explain `password` as a single building block, or a concatenation
 * of two (in either order) — matching the max depth the hand-curated pattern
 * list itself uses. Returns the matched shape, or null if `password` isn't
 * any combination of the given inputs at all (e.g. unrelated to PAN/DOB/name).
 */
export function inferShape(password: string, atoms: Partial<Record<AtomCategory, string[]>>): AtomCategory[] | null {
  const categories = Object.keys(atoms) as AtomCategory[];

  for (const cat of categories) {
    if (atoms[cat]?.includes(password)) return [cat];
  }

  for (const catA of categories) {
    for (const catB of categories) {
      if (catA === catB) continue;
      for (const a of atoms[catA] ?? []) {
        for (const b of atoms[catB] ?? []) {
          if (`${a}${b}` === password) return [catA, catB];
        }
      }
    }
  }

  return null;
}

/**
 * Call after a document opens successfully with `password`. Returns the newly
 * learned shape (for a UI confirmation) — or null if nothing new was learned,
 * either because it's already a known/learned shape, or because `password`
 * doesn't match any combination of the given inputs at all.
 */
export async function learnPatternIfNew(
  password: string,
  inputs: PdfPasswordInputs,
): Promise<AtomCategory[] | null> {
  const shape = inferShape(password, resolveAtoms(inputs));
  if (!shape) return null;
  if (await isKnownShape(shape)) return null;
  await addLearnedShape(shape);
  return shape;
}

/** Candidates generated from every learned shape against the CURRENT inputs
 *  (not the literal password that was learned) — so a learned "name + account
 *  last 4" shape, say, applies to any future document with a different name/account. */
export async function candidatesFromLearnedShapes(inputs: PdfPasswordInputs): Promise<string[]> {
  const learned = await getLearnedShapes();
  if (learned.length === 0) return [];

  const atoms = resolveAtoms(inputs);
  const out: string[] = [];
  for (const shape of learned) {
    if (shape.length === 1) {
      out.push(...(atoms[shape[0]] ?? []));
    } else if (shape.length === 2) {
      for (const a of atoms[shape[0]] ?? []) {
        for (const b of atoms[shape[1]] ?? []) out.push(`${a}${b}`);
      }
    }
  }
  return out;
}
