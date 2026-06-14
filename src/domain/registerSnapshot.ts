/**
 * Builds the portable register snapshot used by the Tier-2 access package
 * (Feature 9) and the full register export (Feature 12). Pure — no DB/React —
 * so the redaction rules are testable. Tested in registerSnapshot.test.ts.
 */

export interface SnapshotAccount {
  name: string;
  type: string;
  institution?: string | null;
  value?: number | null;
  contact?: string | null;
  emergency_action?: string | null;
}

export interface SnapshotPerson {
  name: string;
  relationship?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface SnapshotWill {
  executor?: string | null;
  location_of_original?: string | null;
  registered?: boolean;
  probate_required?: boolean;
}

export interface SnapshotInput {
  generatedOn: string;
  currency: string;
  accounts: SnapshotAccount[];
  people: SnapshotPerson[];
  will?: SnapshotWill | null;
}

export interface RegisterSnapshot extends SnapshotInput {
  version: 1;
  app: "myFinance";
}

export function buildRegisterSnapshot(input: SnapshotInput): RegisterSnapshot {
  return { version: 1, app: "myFinance", ...input };
}

// NOTE: the legacy `redactForTier` tier-redaction has been REMOVED (#10 cutover). Tiered
// estate disclosure now goes through the CORE break-glass contributor path
// (`domain/breakGlassContributor.ts` → `sharedcorelib/breakglass`), which does the
// per-tier redaction once for the whole suite. Byte-parity with the old function is pinned
// in `domain/breakGlassParity.test.ts`. `buildRegisterSnapshot` + the RegisterSnapshot type
// remain — they assemble the snapshot the contributor (and RegisterExport/FamilyPack) consume.
