import type { MasterDef, MasterId, MasterOption } from "./types";
import { fetchCountries, fetchCities } from "./live";
import { LIFE_GOAL_TEMPLATES } from "@/domain/lifeGoals";
// Common masters (country/city/currency/relationship) are owned by the shared
// core and reused here instead of being recreated — see CONTRACT.md and
// [[project_shared_core_extracted]]. Only myFinance-specific masters keep baked
// JSON in this repo.
import { getCommonBaked } from "sharedcorelib/masters";
import institutions from "./data/institutions.json";
import professionalTypes from "./data/professional-types.json";

/** Life-goal categories the user can reuse — the gallery's named templates, sans the open "Others" tile. */
const LIFE_GOAL_BAKED: MasterOption[] = LIFE_GOAL_TEMPLATES.filter((t) => !t.custom).map((t) => ({
  value: t.value,
  label: t.label,
  source: "baked" as const,
}));

export const MASTERS: Record<MasterId, MasterDef> = {
  country: {
    id: "country",
    label: "Country",
    baked: getCommonBaked("country"),
    live: fetchCountries,
    allowOther: true,
  },
  city: {
    id: "city",
    label: "City",
    baked: [],
    // baked cities are parent-scoped (common master); resolved via `bakedOptionsFor` below
    live: fetchCities,
    dependsOnParent: true,
    allowOther: true,
  },
  currency: {
    id: "currency",
    label: "Currency",
    baked: getCommonBaked("currency"),
    allowOther: false,
  },
  institution: {
    id: "institution",
    label: "Institution",
    baked: institutions as MasterOption[],
    allowOther: true,
  },
  life_goal: {
    id: "life_goal",
    label: "Life goal",
    baked: LIFE_GOAL_BAKED,
    allowOther: true,
  },
  relationship: {
    id: "relationship",
    label: "Relationship",
    baked: getCommonBaked("relationship"),
    allowOther: true,
  },
  professional_type: {
    id: "professional_type",
    label: "Professional type",
    baked: professionalTypes as MasterOption[],
    allowOther: true,
  },
};

/** Lower-cased set of baked professional types — used to infer whether an existing
 *  person is a professional (for picking the right Add-People form on edit). */
const PROFESSIONAL_TYPE_KEYS = new Set(
  (professionalTypes as MasterOption[]).map((o) => o.value.trim().toLowerCase()),
);

/** True when a relationship value names a known professional type (baked set). */
export function isProfessionalType(value: string | null | undefined): boolean {
  return !!value && PROFESSIONAL_TYPE_KEYS.has(value.trim().toLowerCase());
}

/**
 * Baked options for a master, resolving parent-scoped sets (cities). The common
 * masters (country/city/currency/relationship) come from the shared core; the
 * rest from this app's own baked data. Kept here rather than on the `MasterDef`
 * so the def stays serialisable/pure data.
 */
export function bakedOptionsFor(id: MasterId, parent: string | null): MasterOption[] {
  if (id === "city") return getCommonBaked("city", parent);
  if (id === "country" || id === "currency" || id === "relationship") return getCommonBaked(id);
  return MASTERS[id].baked;
}
