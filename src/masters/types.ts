/**
 * Master-data layer: a "master" is a finite (or finite-ish) set of values a
 * field can take — country, city, currency, institution, life-goal category.
 * Each master is sourced from a baked static JSON (always present, offline-safe),
 * optionally enriched by a no-auth public API at runtime, and grown by the user's
 * own "Other" additions persisted in the `custom_options` SQLite table.
 *
 * Pure types only — no React, no DB. See `store.ts` for the load/merge hook and
 * `registry.ts` for the catalog.
 */

export interface MasterOption {
  /** Canonical stored value (e.g. ISO country code, currency code, or the label itself). */
  value: string;
  /** Human-facing label shown in the input. */
  label: string;
  /** Optional leading glyph (e.g. a country flag emoji). */
  icon?: string;
  /** Where this option came from — drives sort priority and de-dupe wins. */
  source?: "baked" | "live" | "custom" | "remote";
}

export type MasterId =
  | "country"
  | "city"
  | "currency"
  | "institution"
  | "life_goal"
  | "relationship"
  | "professional_type";

export interface MasterDef {
  id: MasterId;
  label: string;
  /** Baked fallback dataset (statically imported JSON), always available. */
  baked: MasterOption[];
  /**
   * Optional live loader for a no-auth public API. Receives the resolved parent
   * value (e.g. selected country code for `city`). Must resolve to `null` on any
   * failure / offline / non-Tauri so the store silently keeps the baked data.
   */
  live?: (parent: string | null) => Promise<MasterOption[] | null>;
  /** True when this master depends on a parent selection (e.g. city ← country). */
  dependsOnParent?: boolean;
  /** Whether to offer an "Other…" affordance that grows the master. Defaults true. */
  allowOther?: boolean;
}
