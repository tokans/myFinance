/**
 * Shared "does this document actually belong where I'm importing it" check
 * for Form 16 / 26AS import (`Form16Import.tsx` / `TdsDocumentImport.tsx`).
 * Both pages ask for an Assessment Year up front, defaulted to a hardcoded
 * value, entirely independent of the document the user then uploads — and
 * neither cross-checks the document's own PAN against the saved tax filer
 * profile. This is the "wrong AY box left at its default" / "wrong family
 * member's document" safety net: auto-fill the AY when the field was never
 * touched, warn (without silently overwriting) when the user's own value
 * disagrees with the document, and flag a PAN mismatch for the user to
 * notice rather than acting on it themselves (a PAN mismatch usually just
 * means "wrong file").
 */

/**
 * Form 16's own header parses Assessment Year as "2026-2027" (4-digit end
 * year — see `form16Header.test.ts`), but the app's convention everywhere
 * else (`DEFAULT_AY`, the `ay` DB column, `aisParser.ts`'s `fyToAy`) is
 * "2026-27" (2-digit). Comparing the two forms directly would report a
 * mismatch on every single import. Collapses either shape to the 2-digit
 * form; returns null if the string isn't AY-shaped at all.
 */
export function normalizeAy(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2,4})$/);
  if (!m) return null;
  const endYear = m[2].length === 4 ? m[2].slice(-2) : m[2].padStart(2, "0");
  return `${m[1]}-${endYear}`;
}

export interface AyMismatch {
  detected: string;
  current: string;
}

export interface PanMismatch {
  detected: string;
  expected: string;
}

export interface DocumentIdentityCheck {
  /** The AY to actually use — `currentAy` unless silently auto-filled. */
  effectiveAy: string;
  /** True when `effectiveAy` was silently set from the document because the
   *  field was still at its untouched default. */
  ayAutoFilled: boolean;
  /** Set when the document disagrees with an AY the user already chose —
   *  surface as a dismissible "use the detected value?" prompt, never
   *  auto-applied. */
  ayMismatch: AyMismatch | null;
  /** Set when the document's PAN disagrees with the saved tax filer profile. */
  panMismatch: PanMismatch | null;
}

export function checkDocumentIdentity(params: {
  detectedAy: string | null;
  detectedPan: string | null;
  currentAy: string;
  defaultAy: string;
  profilePan: string;
}): DocumentIdentityCheck {
  const { detectedPan, currentAy, profilePan } = params;
  const detectedAy = normalizeAy(params.detectedAy);
  const normalizedCurrent = normalizeAy(currentAy) ?? currentAy;
  const normalizedDefault = normalizeAy(params.defaultAy) ?? params.defaultAy;

  let effectiveAy = currentAy;
  let ayAutoFilled = false;
  let ayMismatch: AyMismatch | null = null;

  if (detectedAy && detectedAy !== normalizedCurrent) {
    if (normalizedCurrent === normalizedDefault) {
      effectiveAy = detectedAy;
      ayAutoFilled = true;
    } else {
      ayMismatch = { detected: detectedAy, current: currentAy };
    }
  }

  let panMismatch: PanMismatch | null = null;
  if (detectedPan && profilePan && detectedPan.toUpperCase() !== profilePan.toUpperCase()) {
    panMismatch = { detected: detectedPan, expected: profilePan };
  }

  return { effectiveAy, ayAutoFilled, ayMismatch, panMismatch };
}
