import { z } from "zod";
import { isTauri } from "@/lib/environment";
import {
  verifyGrant,
  createGrantReceiver,
  type GrantKeys,
  type GrantKind,
  type GrantReceiver,
} from "sharedcorelib/grant";

/**
 * Patron / Partner entitlement grants — built on the shared **receive-only grant**
 * handoff (`sharedcorelib/grant`). The app only ever RECEIVES a status; it never
 * uploads user data. There is exactly ONE channel: a signed+encrypted file the
 * publisher hands the user, saved into Downloads under a known name —
 *
 *   - {@link PATRON_FILE_NAME}  after a donation        → Patron  (`kind: "patron"`)
 *   - {@link PARTNER_FILE_NAME} after pro enrollment     → Partner (`kind: "partner"`)
 *
 * The app reads exactly those two known paths; it never enumerates the folder. The
 * grant's `kind` is the discriminator (matching `sharedcorelib/grant`'s `GrantKind`),
 * so a file is only accepted for the channel it declares.
 *
 * Verification (verify-before-decrypt) and the envelope format come from the lib, so
 * grant files keep verifying. Keys are SEPARATE from the masters keys (grants may be
 * minted online). The baked values below are fail-closed PLACEHOLDERS (all-zero ⇒
 * verification always fails) until replaced with real values.
 */

/** Downloads filename for a donation (Patron) grant. */
export const PATRON_FILE_NAME = "myfinance-patron.tokans";

/** Downloads filename for a professional-enrollment (Partner) grant. */
export const PARTNER_FILE_NAME = "myfinance-partner.tokans";

/** Baked Ed25519 public key for grants (32 bytes, hex). */
export const PATRON_PUBKEY_HEX =
  "d0131c56a33bc8e1d3c328b64951835125a2eddeb5dd82243c934ff4b0716a4c";

/** Baked AES-256 transport key for grants (32 bytes, base64). */
export const PATRON_TRANSPORT_KEY_B64 = "O3JzgTGhWezl/00XkHjgippuKpfWR/pcuflZJqmQGKQ=";

const GRANT_KEYS: GrantKeys = {
  pubkeyHex: PATRON_PUBKEY_HEX,
  transportKeyB64: PATRON_TRANSPORT_KEY_B64,
};

/** Decrypted grant payload. Bounded like the masters payloads (signed-but-evil defense). */
const grantPayloadSchema = z.object({
  /** Which entitlement this grant confers (mirrors `sharedcorelib/grant` `GrantKind`). */
  kind: z.enum(["patron", "partner"]),
  /** Date the donation/enrollment took effect, 'YYYY-MM-DD'. Drives the Partner window. */
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Optional informational fields — ignored if absent. */
  issuedAt: z.string().max(40).optional(),
  note: z.string().max(200).optional(),
});

export type GrantPayload = z.infer<typeof grantPayloadSchema>;

/**
 * Verify + decrypt raw grant bytes into a validated payload. Throws on any failure
 * (bad JSON, bad signature, decrypt failure, malformed payload) so the caller can
 * fail silently and leave entitlement state untouched. Defaults to the baked keys.
 */
export async function verifyAndDecryptGrant(
  fileBytes: Uint8Array,
  opts: { pubkeyHex?: string; transportKeyB64?: string } = {},
): Promise<GrantPayload> {
  const raw = await verifyGrant(fileBytes, {
    pubkeyHex: opts.pubkeyHex ?? PATRON_PUBKEY_HEX,
    transportKeyB64: opts.transportKeyB64 ?? PATRON_TRANSPORT_KEY_B64,
  });
  return grantPayloadSchema.parse(raw);
}

/** A file-channel receiver bound to the baked keys, accepting only the given `kind`. */
function grantReceiver(kind: GrantKind, fileName: string): GrantReceiver<GrantPayload> {
  return createGrantReceiver<GrantPayload>({
    ...GRANT_KEYS,
    parsePayload: (raw) => {
      const payload = grantPayloadSchema.parse(raw);
      if (payload.kind !== kind) throw new Error(`expected ${kind} grant`);
      return payload;
    },
    readDroppedFile: async () => {
      if (!isTauri()) return null;
      const { downloadDir, join } = await import("@tauri-apps/api/path");
      const { readFile } = await import("@tauri-apps/plugin-fs");
      return readFile(await join(await downloadDir(), fileName)); // throws if absent → null upstream
    },
  });
}

/**
 * Read the donation (Patron) grant from Downloads, if present, and return its
 * validated payload — or null when there is no (valid) file. Never throws. Reads
 * exactly one known path; it does not enumerate the user's Downloads.
 */
export async function readPatronGrant(): Promise<GrantPayload | null> {
  return grantReceiver("patron", PATRON_FILE_NAME).fromFile();
}

/**
 * Read the professional-enrollment (Partner) grant from Downloads, if present.
 * Same receive-only, never-throws contract as {@link readPatronGrant}.
 */
export async function readPartnerGrant(): Promise<GrantPayload | null> {
  return grantReceiver("partner", PARTNER_FILE_NAME).fromFile();
}
