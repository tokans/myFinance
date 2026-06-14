/**
 * AES-256-GCM sealing for document blobs. The implementation now lives in the
 * shared core (`sharedcorelib/vault`): `sealWithKey`/`openWithKey` are the pure,
 * key-injected primitives (tested in docCrypto.test.ts), while `sealBytes`/
 * `openBytes` bind to myFinance's vault DEK. Re-export shim so existing
 * `@/vault/docCrypto` import sites stay unchanged. See [[project_shared_core_extracted]].
 */
import { vault } from "./stronghold";

export { sealWithKey, openWithKey } from "sharedcorelib/vault";

/** Seal a document blob with the vault's DEK. Requires an unlocked vault. */
export const sealBytes = vault.sealBytes;
/** Decrypt a sealed document blob with the vault's DEK. Requires an unlocked vault. */
export const openBytes = vault.openBytes;
