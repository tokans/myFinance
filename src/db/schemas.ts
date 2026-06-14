import type { SchemaDescriptor } from "sharedcorelib/schema";
import { registerSchemas, registerAuxMigrations, type SqlDb } from "sharedcorelib/db";
import { ICE_CARD_SCHEMA } from "sharedcorelib/ice";
import { ENTITY_SCHEMAS } from "sharedcorelib/entities";
import { BREAKGLASS_SCHEMAS } from "sharedcorelib/breakglass";
import { APP_ID } from "./tables";
import { MYFINANCE_LEGACY_SCHEMAS } from "./legacySchemas";
import { MYFINANCE_AUX_MIGRATIONS } from "./auxSql";

/**
 * myFinance-owned facet table for the shared `person` spine. The shared `common_person`
 * row carries identity ONLY (name/relationship/contacts/dob); finance-specific data
 * (estate access tier, id-proof reference, notes) lives here, keyed by the shared
 * `person_key` (field-level ownership — health owns medical facets, finance owns these).
 * This is the explicit-reference bridge: a local `myfinance_people` row maps to one shared
 * `person`, and finance keeps its own fields beside core identity rather than re-modeling
 * the person (suite invariant 6).
 */
export const MYFINANCE_PERSON_FACET_SCHEMA: SchemaDescriptor = {
  namespace: "myfinance",
  name: "PersonFacet",
  plural: "PersonFacets",
  dbAlias: "myfinance_person_facet",
  schemaType: "Table",
  confidentiality: "Confidential",
  owner: "myfinance",
  purpose: "Finance-specific facet data attached to a shared person (estate access tier, id-proof, notes).",
  fields: [
    { name: "person_key", dataType: "id", keyField: true, editability: "Immutable", description: "shared person_key this facet attaches to" },
    { name: "access_tier", dataType: "number", description: "estate progressive-access tier (0/1/2)" },
    { name: "id_proof_ref", dataType: "string", confidentiality: "Restricted", personalData: true, purpose: "Locate the person's identity proof for estate claims.", description: "id-proof reference (optional)" },
    { name: "notes", dataType: "string", confidentiality: "Confidential", personalData: true, purpose: "Finance-side note about this person for estate readiness.", description: "free-text notes (optional)" },
    { name: "local_person_id", dataType: "number", description: "back-reference to the app-local myfinance_people.id for migration/reconciliation" },
    { name: "updated_at", dataType: "date", description: "ISO timestamp of the last edit" },
    { name: "source_app", dataType: "string", description: "app id that last wrote this row" },
  ],
};

/**
 * myFinance's contribution to the SHARED suite database (sharedcorelib/db) — the ONLY
 * database after K1 consolidation (prompts/10, decisions 1/2/6). ALL of this app's data —
 * domain, settings, telemetry, estate, tax — lives as app-owned namespaced `myfinance_*`
 * tables in the one `suite.db`; the per-app `myfinance.db` is migrated once and deleted
 * (see ./consolidate.ts). The Stronghold vault stays strictly per-app and is NEVER part
 * of the suite DB.
 *
 * Every table is a semantic SchemaDescriptor (purpose, confidentiality, DPDP personalData
 * + purpose, constraints) registered into the shared schema registry on launch (idempotent,
 * append-only; the registry blocks cross-app duplication and the publish-time `schema-merge`
 * gate checks them). What descriptors can't express — integer AUTOINCREMENT keys, CHECKs,
 * DEFAULTs, FK cascades, composite UNIQUEs, and the 0021/0022 sync-trigger suite — is
 * carried by the app-scoped aux-SQL steps (./auxSql.ts) via the core `registerAuxMigrations`
 * mechanism. The retired Tauri-plugin migration array is gone from lib.rs.
 *
 * Keep `schema.manifest.json` (repo root, used by publisher-ci) in sync with this list.
 */
export const MYFINANCE_SCHEMAS: SchemaDescriptor[] = [
  // Every legacy myfinance.db table, descriptor-ized + namespaced. HealthProfile in
  // this list ADOPTS common#IceCard (creates no table — invariant 6).
  ...MYFINANCE_LEGACY_SCHEMAS,
  // myFinance-owned facet attaching finance data to a shared person.
  MYFINANCE_PERSON_FACET_SCHEMA,
  // The suite's single shared emergency card (owner "common"). Registered by whichever
  // app launches first; myFinance reads + edits the same row-set myHealth does.
  ICE_CARD_SCHEMA,
  // The shared-entity spine (owner "common"): person/event/document/asset. Modeled once
  // in core; registered by whichever suite app launches first. myFinance is the deepest
  // consumer (people → person, holdings/accounts → asset, docs → document, life-events → event).
  ...ENTITY_SCHEMAS,
  // Break-glass grant ledger + append-only audit (owner "common"). myFinance is the first
  // consumer of the core break-glass mechanism.
  ...BREAKGLASS_SCHEMAS,
];

/**
 * Register myFinance's schemas + aux-SQL steps into the shared suite DB. Idempotent and
 * append-only — call once per launch before any query. A schema conflict THROWS (the
 * publisher-ci gate catches it at build time; this is the runtime backstop). registerSchemas
 * must precede registerAuxMigrations (aux SQL may only touch already-registered tables).
 */
export async function ensureSuiteSchema(db: SqlDb): Promise<void> {
  await registerSchemas(db, MYFINANCE_SCHEMAS);
  await registerAuxMigrations(db, APP_ID, MYFINANCE_AUX_MIGRATIONS);
}
