/**
 * Dashboard-only grouping of asset account types into a Schedule-AL/net-worth-
 * statement style breakdown (Bank / Shares & securities / Insurance / Loans
 * given / Cash in hand / Provident & pension funds / Virtual digital assets /
 * Real estate / Jewellery & bullion / Archaeological & art / Vehicles /
 * Others).
 *
 * Decoupled from accountTypes.ts on purpose — this is a display grouping, not
 * part of the account-type vocabulary itself. `tax_refund` (and both liability
 * types) are deliberately left unmapped: they never appear in the Dashboard's
 * per-category breakdown (still counted in the Total savings headline, which
 * reads straight from monthly_snapshot).
 */
import type { AccountType } from "./accountTypes";

export type AssetCategory =
  | "bank"
  | "shares_securities"
  | "insurance"
  | "loans_given"
  | "cash_in_hand"
  | "provident_pension"
  | "virtual_digital_assets"
  | "real_estate"
  | "jewellery_bullion"
  | "art_collectibles"
  | "vehicles"
  | "other";

export interface AssetCategoryMeta {
  value: AssetCategory;
  label: string;
  types: AccountType[];
}

/** Display order for the Dashboard's per-category breakdown. */
export const ASSET_CATEGORIES: AssetCategoryMeta[] = [
  { value: "bank", label: "Bank (including all deposits)", types: ["bank_savings", "checking", "fixed_deposit", "recurring_deposit"] },
  { value: "shares_securities", label: "Shares and securities", types: ["stocks", "mutual_funds", "etf", "bonds", "pms_aif"] },
  { value: "insurance", label: "Insurance policies", types: ["insurance"] },
  { value: "loans_given", label: "Loans and advances given", types: ["loan_given"] },
  { value: "cash_in_hand", label: "Cash in hand", types: ["cash"] },
  { value: "provident_pension", label: "Provident & pension funds", types: ["ppf", "epf", "nps"] },
  { value: "virtual_digital_assets", label: "Virtual digital assets", types: ["crypto"] },
  { value: "real_estate", label: "Real estate", types: ["real_estate"] },
  { value: "jewellery_bullion", label: "Jewellery, bullion etc.", types: ["gold"] },
  { value: "art_collectibles", label: "Archaeological collections, drawings, painting, sculpture or any work of art", types: ["art_collectible"] },
  { value: "vehicles", label: "Vehicles, yachts, boats and aircrafts", types: ["vehicle"] },
  { value: "other", label: "Others", types: ["other"] },
];

const CATEGORY_BY_TYPE: Partial<Record<AccountType, AssetCategory>> = Object.fromEntries(
  ASSET_CATEGORIES.flatMap((c) => c.types.map((t) => [t, c.value])),
);

/** The asset-breakdown category for a stored account type, or null if it isn't shown there. */
export function assetCategoryForType(type: string): AssetCategory | null {
  return CATEGORY_BY_TYPE[type as AccountType] ?? null;
}
