/**
 * Client-side verification + decryption for over-the-air master/partner updates.
 *
 * The crypto/verification ENGINE now lives in the shared core
 * (`sharedcorelib/masters`). This module keeps myFinance's PER-APP secrets — the
 * baked signing public key + transport key — and binds the engine to myFinance's
 * own manifest schema, so existing `@/masters/verify` import sites stay unchanged.
 * See [[project_shared_core_extracted]].
 *
 * The baked keys below are PLACEHOLDERS. Until they're replaced with the real
 * values printed by `npm run masters:keys`, signature verification fails closed
 * and no update is ever applied — the safe default.
 */
import {
  verifyManifestSignature as engineVerifySig,
  decryptTransport as engineDecrypt,
  verifyAndDecryptManifest as engineVerifyManifest,
  sha256Hex,
  meetsMinVersion,
  type VerifiedEntry,
} from "sharedcorelib/masters";
import { manifestSchema, type MastersManifest } from "./updateSchema";

/** Baked Ed25519 public key (32 bytes, hex). Replace via `npm run masters:keys`. */
export const MASTERS_PUBKEY_HEX =
  "7a0d6376b6edb622142e5a0cc1bfc8d3890a24b8b8488dd7a86497d0b0e5f12c";

/** Baked AES-256 transport key (32 bytes, base64). Replace via `npm run masters:keys`. */
export const MASTERS_TRANSPORT_KEY_B64 = "S19eRWy7nJO3eK+NZe/9VVEDz4udlfpeNO6iRWvlmxY=";

export { sha256Hex, meetsMinVersion };
export type { VerifiedEntry };

/** Verify a detached Ed25519 signature over the raw manifest bytes. Never throws. */
export function verifyManifestSignature(
  manifestBytes: Uint8Array,
  sigBytes: Uint8Array,
  pubkeyHex: string = MASTERS_PUBKEY_HEX,
): Promise<boolean> {
  return engineVerifySig(manifestBytes, sigBytes, pubkeyHex);
}

/** AES-256-GCM decrypt a `iv(12) || ciphertext || tag(16)` blob with the transport key. */
export function decryptTransport(
  enc: Uint8Array,
  keyB64: string = MASTERS_TRANSPORT_KEY_B64,
): Promise<Uint8Array> {
  return engineDecrypt(enc, keyB64);
}

export interface VerifyOptions {
  fetchFile: (file: string) => Promise<Uint8Array>;
  pubkeyHex?: string;
  transportKeyB64?: string;
  lastRevision?: number;
  appVersion?: string;
}

/**
 * Full verify-then-decrypt pass over a signed manifest, defaulting to myFinance's
 * keys + manifest schema. Throws on any failure so the caller can fail silently.
 */
export function verifyAndDecryptManifest(
  manifestBytes: Uint8Array,
  sigBytes: Uint8Array,
  opts: VerifyOptions,
): Promise<{ manifest: MastersManifest; entries: VerifiedEntry[] }> {
  return engineVerifyManifest<MastersManifest>(manifestBytes, sigBytes, {
    fetchFile: opts.fetchFile,
    pubkeyHex: opts.pubkeyHex ?? MASTERS_PUBKEY_HEX,
    transportKeyB64: opts.transportKeyB64 ?? MASTERS_TRANSPORT_KEY_B64,
    manifestSchema,
    lastRevision: opts.lastRevision,
    appVersion: opts.appVersion,
  });
}
