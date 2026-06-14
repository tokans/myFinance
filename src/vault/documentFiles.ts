/**
 * On-disk store for encrypted document blobs (under `$APPDATA/documents/<uuid>`).
 * The implementation now lives in the shared core (`sharedcorelib/vault`); this
 * is a re-export shim binding to myFinance's vault so existing
 * `@/vault/documentFiles` import sites stay unchanged. See [[project_shared_core_extracted]].
 */
import { vault } from "./stronghold";

/** Encrypt `bytes` and write them under a fresh uuid file name, which is returned. */
export const saveBlob = vault.saveBlob;
/** Read and decrypt a stored blob. Requires an unlocked vault. */
export const readBlob = vault.readBlob;
/** Delete a stored blob. Silently ignores a file that's already gone. */
export const deleteBlob = vault.deleteBlob;
