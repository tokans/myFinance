/**
 * Filer identity used to build an ITR JSON (PAN, name, DOB, address, refund bank
 * account, filing status, regime). Not part of the typed AppSettings — it's
 * persisted as a single JSON blob via the settings key/value table's ancillary
 * accessors (getSetting/setSetting), the pattern db/settings.ts documents for
 * values that don't belong in core settings.
 */

import { getSetting, setSetting } from "@/db/settings";
import type { Regime } from "@/tax/taxCompute";

const KEY = "tax_filer_profile";

export interface TaxProfile {
  pan: string;
  name: string;
  /** DOB as YYYY-MM-DD (matches ITR PersonalInfo.DOB). */
  dob: string;
  aadhaar: string;
  flatDoorBlock: string;
  premisesBuildingVillage: string;
  road: string;
  areaLocality: string;
  city: string;
  state: string;
  pinCode: string;
  email: string;
  mobile: string;
  bankIfsc: string;
  bankAccountNumber: string;
  /** Preferred tax regime for the computation + return. */
  regime: Regime;
}

export const EMPTY_TAX_PROFILE: TaxProfile = {
  pan: "",
  name: "",
  dob: "",
  aadhaar: "",
  flatDoorBlock: "",
  premisesBuildingVillage: "",
  road: "",
  areaLocality: "",
  city: "",
  state: "",
  pinCode: "",
  email: "",
  mobile: "",
  bankIfsc: "",
  bankAccountNumber: "",
  regime: "new",
};

export async function loadTaxProfile(): Promise<TaxProfile> {
  const raw = await getSetting(KEY);
  if (!raw) return { ...EMPTY_TAX_PROFILE };
  try {
    return { ...EMPTY_TAX_PROFILE, ...(JSON.parse(raw) as Partial<TaxProfile>) };
  } catch {
    return { ...EMPTY_TAX_PROFILE };
  }
}

export async function saveTaxProfile(profile: TaxProfile): Promise<void> {
  await setSetting(KEY, JSON.stringify(profile));
}
