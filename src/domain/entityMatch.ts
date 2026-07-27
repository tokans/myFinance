/**
 * Fuzzy institution/entity-name matching, shared by `sftCrossCheck.ts` (SFT
 * reporting-entity vs. account institution) and `recon.ts` (cross-document
 * payer-name matching). Deterministic (no LLM, per house rule): lowercase,
 * strip common corporate-suffix noise, then a loose substring containment
 * check — good enough for "is this probably the same institution", never
 * authoritative.
 */

/** Lowercase, strip common corporate-suffix noise and punctuation, for a loose substring match. */
export function normalizeEntity(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(ltd|limited|pvt|private|co|company|bank|inc)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function entitiesMatch(a: string | null, b: string | null): boolean {
  const na = a ? normalizeEntity(a) : "";
  const nb = b ? normalizeEntity(b) : "";
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}
