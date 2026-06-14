import { iceStore } from "./sharedDb";

/**
 * Hospitalisation-ready health profile (the ICE medical card).
 *
 * Post-consolidation (prompts/10, invariant 6) the legacy single-row
 * `health_profile` table is RETIRED: these facts now live ONCE suite-wide on the
 * common ICE card (`common#IceCard`, person_key "self"), which sibling apps
 * (myHealth's medical card) also read/write. This wrapper preserves the original
 * field-shaped API but delegates to the shared `iceStore()` so there is no
 * duplicate copy. `legacySchemas.ts`'s HealthProfile descriptor ADOPTS
 * common#IceCard; the one-time migrator maps any legacy `health_profile` row into
 * the ICE card.
 */
const SELF = "self";

export interface HealthProfile {
  id: 1;
  full_name: string | null;
  blood_group: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  medications: string | null;
  organ_donor: number;
  notes: string | null;
  updated_at: string;
}

export interface HealthProfileInput {
  full_name?: string | null;
  blood_group?: string | null;
  allergies?: string | null;
  chronic_conditions?: string | null;
  medications?: string | null;
  organ_donor?: boolean;
  notes?: string | null;
}

const norm = (v: string | null | undefined): string | null => v?.trim() || null;

export async function getHealthProfile(): Promise<HealthProfile | null> {
  const store = await iceStore();
  if (!store) return null;
  const card = await store.get(SELF);
  if (!card) return null;
  return {
    id: 1,
    full_name: card.display_name ?? null,
    blood_group: card.blood_group ?? null,
    allergies: card.allergies ?? null,
    chronic_conditions: card.conditions ?? null,
    medications: card.medications ?? null,
    organ_donor: card.organ_donor ?? 0,
    notes: card.notes ?? null,
    updated_at: card.updated_at ?? "",
  };
}

export async function upsertHealthProfile(input: HealthProfileInput): Promise<void> {
  const store = await iceStore();
  if (!store) return;
  // Merge over any existing card so we don't clobber fields a sibling app owns
  // (e.g. contact_name/phone written by myHealth).
  const existing = await store.get(SELF);
  await store.upsert({
    ...existing,
    person_key: SELF,
    display_name: norm(input.full_name),
    blood_group: norm(input.blood_group),
    allergies: norm(input.allergies),
    conditions: norm(input.chronic_conditions),
    medications: norm(input.medications),
    organ_donor: input.organ_donor ? 1 : 0,
    notes: norm(input.notes),
    updated_at: new Date().toISOString(),
    source_app: "myfinance",
  });
}

/** Clear the self ICE card. */
export async function clearHealthProfile(): Promise<void> {
  const store = await iceStore();
  if (!store) return;
  await store.remove(SELF);
}
