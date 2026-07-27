/**
 * Shared-entity spine wiring (sharedcorelib/entities) for myFinance — Stage C migration.
 *
 * myFinance is the suite's deepest core consumer. Estate people/nominees/contacts now
 * REFERENCE the shared `common_person` identity (explicit-reference, no auto-merge), and
 * financial/physical holdings project onto the shared `common_asset` table so myFinance can
 * act as the cross-app **net-worth aggregator** (assets contributed by myHome/myHobbies are
 * summed alongside its own). Documents → `common_document`, cross-app life-events →
 * `common_event`.
 *
 * Design rules honored (contracts/entities.md, suite invariant 6):
 *   - The shared `person` row is identity ONLY. Finance-specific data (estate access tier,
 *     id-proof, notes) lives in the myFinance-owned facet table keyed by `person_key`
 *     (field-level ownership). We never re-model the person locally.
 *   - Identity is explicit-reference. Dedup is a *suggestion* a human confirms
 *     ({@link suggestPersonDuplicates}) — never an auto-merge.
 *
 * Person-spine WRITES (common_person + myfinance_person_facet + the myfinance_people thin
 * link, keyed `mf-<id>`) are owned solely by {@link module:db/people} — this module is the
 * read/aggregate side (the entities store, dedup suggestions, net-worth aggregation).
 *
 * This module is Tauri-only for its live store; the pure helpers are unit-testable without it.
 */
import { isTauri } from "@/lib/environment";
import { openSharedDbAdapter } from "./sharedDb";
import {
  createEntitiesStore,
  type EntitiesStore,
  type Person as SharedPerson,
  type Asset as SharedAsset,
  type DocumentRow as SharedDocument,
  type EventRow as SharedEvent,
  type DuplicateSuggestion,
} from "sharedcorelib/entities";

const APP_ID = "myfinance";

export type {
  SharedPerson, SharedAsset, SharedDocument, SharedEvent, DuplicateSuggestion,
};

/**
 * The shared entities store bound to the suite DB, or null outside Tauri / when the shared
 * DB can't be opened (callers degrade gracefully, exactly like {@link iceStore}).
 */
export async function entitiesStore(): Promise<EntitiesStore | null> {
  if (!isTauri()) return null;
  try {
    const sql = await openSharedDbAdapter();
    const store = createEntitiesStore(sql, { appId: APP_ID });
    await store.ensure();
    return store;
  } catch (e) {
    console.warn("shared entities store unavailable:", e);
    return null;
  }
}

// ── Pure helpers (DI; unit-testable without Tauri) ──────────────────────────
//
// NOTE: writing a finance contact onto the spine (common_person + myfinance_person_facet +
// the myfinance_people thin link) is owned SOLELY by db/people.ts (createPerson/updatePerson,
// keyed `mf-<id>` via personKeyForLocal). There is intentionally no second writer here — a
// parallel link helper would risk a divergent, name-slug-keyed identity (finding 2.1).

/**
 * Guided-merge: which shared people *look* like duplicates of a local person (same name
 * and/or DOB)? SUGGEST ONLY — the caller surfaces these to a human who confirms. Used to
 * dedupe against health profiles / memories persons across the suite.
 */
export async function suggestPersonDuplicates(
  entities: EntitiesStore,
  local: { name: string; dob?: string | null; person_key?: string },
): Promise<DuplicateSuggestion[]> {
  return entities.suggestDuplicates({
    display_name: local.name,
    dob: local.dob ?? null,
    person_key: local.person_key,
  });
}

// ── Net-worth aggregation (Phase 2) ─────────────────────────────────────────

/** A locally-owned finance asset (one per account) projected into the shared spine. */
export interface LocalAssetLike {
  /** stable id for the shared asset row (e.g. `myfinance:account:<id>`) */
  id: string;
  label: string;
  value?: number | null;
  ownerKey?: string | null;
  type?: SharedAsset["type"];
}

/** Project a local finance account onto the shared `asset` spine (type=account). */
export async function publishLocalAsset(entities: EntitiesStore, a: LocalAssetLike): Promise<void> {
  await entities.upsertAsset({
    id: a.id,
    type: a.type ?? "account",
    label: a.label,
    value: a.value ?? null,
    owner: a.ownerKey ?? "self",
  });
}

export interface NetWorthAggregate {
  /** every asset across the suite owned by `ownerKey` (finance + myHome + myHobbies, …) */
  assets: SharedAsset[];
  /** summed value of those assets (the cross-app net worth) */
  total: number;
  /** breakdown by the contributing `source_app` (provenance of cross-app contributions) */
  byApp: Record<string, number>;
}

/**
 * Aggregate net worth across ALL shared assets owned by a person — including assets
 * contributed by sibling apps (myHome property, myHobbies collections). myFinance becomes
 * the suite aggregator; the estate register reads from this shared view, not a private copy.
 */
export async function aggregateNetWorth(
  entities: EntitiesStore,
  ownerKey = "self",
): Promise<NetWorthAggregate> {
  const { assets, total } = await entities.assetsForOwner(ownerKey);
  const byApp: Record<string, number> = {};
  for (const a of assets) {
    const app = a.source_app ?? "unknown";
    byApp[app] = (byApp[app] ?? 0) + (typeof a.value === "number" ? a.value : 0);
  }
  return { assets, total, byApp };
}
