import { z } from "zod";

/**
 * Wire format + validation for over-the-air master updates. Shared by the offline
 * packer (`scripts/pack-masters.ts`) and, later, the runtime loader/verifier so the
 * same contract is enforced on both ends. Pure data + zod — no React, no DB.
 *
 * Security note: every field is bounded (length / range / count caps) so that even
 * a correctly-signed-but-malicious payload can do no worse than supply bad data —
 * it can never blow up memory or smuggle oversized junk into the DB or UI. See
 * docs/plans/master-and-app-updates.md (Phase 10, sink hardening).
 */

/** Master ids eligible for OTA updates. Keep in sync with `MasterId` in types.ts. */
export const MASTER_IDS = [
  "country",
  "city",
  "currency",
  "institution",
  "life_goal",
  "relationship",
  "professional_type",
] as const;

export const masterIdSchema = z.enum(MASTER_IDS);

/** A single option inside a decrypted master payload. Bounds are deliberately tight. */
export const masterOptionSchema = z.object({
  value: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  icon: z.string().max(16).optional(),
  /** Dependency key for parent-scoped sets (e.g. city → ISO country code). */
  parent: z.string().max(32).nullish(),
});

/** The decrypted payload of one `<id>.master.enc` file: a bounded option list. */
export const masterPayloadSchema = z.array(masterOptionSchema).max(100_000);

/**
 * Professional-partners track (migration 0020). Unlike a plain master option, a
 * partner carries contact fields so selecting one can auto-fill the person form.
 * Distributed via the same encrypt-then-sign OTA mechanism but as its own payload
 * (`partner.master.enc`) and ingested into the `partners` table, not `master_options`.
 * Bounds are deliberately tight (see masterOptionSchema rationale above).
 */
export const partnerOptionSchema = z.object({
  /** Matches a value of the `professional_type` master (e.g. 'Doctor'). */
  professionalType: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(160).nullish(),
  notes: z.string().trim().max(500).nullish(),
  icon: z.string().max(16).optional(),
});

/** The decrypted payload of `partner.master.enc`: a bounded partner list. */
export const partnerPayloadSchema = z.array(partnerOptionSchema).max(100_000);

/** A manifest entry id: any master id, or the special "partner" payload (→ partners table). */
export const manifestIdSchema = z.union([masterIdSchema, z.literal("partner")]);

/** One manifest entry describing an encrypted master/partner file. */
export const manifestEntrySchema = z.object({
  id: manifestIdSchema,
  /** Asset filename, e.g. "country.master.enc". */
  file: z.string().min(1).max(128),
  /** Byte length of the ciphertext file. */
  bytes: z.number().int().nonnegative(),
  /** Hex SHA-256 of the ciphertext file. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Per-master revision (monotonic). */
  version: z.number().int().nonnegative(),
});

/**
 * The signed manifest. `revision` is the monotonic anti-downgrade counter the
 * client persists and refuses to go below; `minAppVersion` gates compatibility so
 * an old binary never ingests data shaped for a newer schema.
 */
export const manifestSchema = z.object({
  revision: z.number().int().nonnegative(),
  generatedAt: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  minAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  entries: z.array(manifestEntrySchema).min(1),
});

export type MasterPayloadItem = z.infer<typeof masterOptionSchema>;
export type MasterPayload = z.infer<typeof masterPayloadSchema>;
export type PartnerPayloadItem = z.infer<typeof partnerOptionSchema>;
export type PartnerPayload = z.infer<typeof partnerPayloadSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type MastersManifest = z.infer<typeof manifestSchema>;
