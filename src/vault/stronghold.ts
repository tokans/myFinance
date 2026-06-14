/**
 * The vault implementation now lives in the shared core (`sharedcorelib/vault`).
 * This module instantiates myFinance's single app-level vault and re-exports its
 * methods so existing `@/vault/stronghold` import sites stay unchanged.
 *
 * The Stronghold snapshot-key derivation (Argon2id salt/params) is PER-APP and
 * lives in `src-tauri/src/lib.rs` — never change it (it would brick existing
 * vaults). This wrapper only supplies the client name + snapshot file name.
 * See [[project_shared_core_extracted]].
 */
import { createVault, type Credential } from "sharedcorelib/vault";

export type { Credential };

/** myFinance's single app-level vault instance. */
export const vault = createVault({
  clientName: "myfinance",
  snapshotFile: "vault.stronghold",
  // docKeyRecord defaults to "doc-master-key-v1", documentsSubdir to "documents"
  // — myFinance's historical values — so existing data stays readable.
});

export const {
  unlock,
  isUnlocked,
  lock,
  saveSnapshot,
  putCredential,
  getCredential,
  removeCredential,
  newCredentialKey,
  getOrCreateDocumentKey,
} = vault;
