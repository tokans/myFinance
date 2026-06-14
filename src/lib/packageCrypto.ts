/**
 * Passphrase-based encryption for offline export packages (Features 9 & 12).
 *
 * The implementation now lives in the shared core (`sharedcorelib/crypto`); this
 * module is a thin re-export shim so existing `@/lib/packageCrypto` import sites
 * stay unchanged. Distinct from the vault DEK (docCrypto.ts): these packages are
 * sealed with a passphrase the user shares out-of-band, not the master password.
 * See [[project_shared_core_extracted]].
 */
export { encryptJson, decryptJson } from "sharedcorelib/crypto";
