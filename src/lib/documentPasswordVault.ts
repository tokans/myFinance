/**
 * Reuses passwords for password-protected financial/tax documents (bank
 * statements, Form 16, AIS, TIS, Form 26AS, IT-return PDFs, CA computation
 * sheets) across repeat
 * imports of the same source — a new bank statement each month, or a new
 * year's Form16/AIS/26AS, conventionally reuses the same password scheme.
 *
 * Storage is the vault's existing generic credential store
 * (`putCredential`/`getCredential`, Stronghold-backed — see `@/vault/stronghold`),
 * under a deterministic key per (document kind, exact source). No new vault
 * plumbing: this is just a namespaced key convention over what already exists.
 *
 * Opt-in only, no global setting: nothing is stored unless the user explicitly
 * confirms via the inline "remember this password?" prompt shown after a
 * document is successfully opened (see `RememberPasswordPrompt`).
 *
 * All three vault-touching functions below go through `ensureVaultUnlocked()`
 * first, which pops the global unlock dialog (`VaultUnlockDialog`) when the
 * vault is locked rather than letting the underlying `getCredential`/
 * `putCredential` call throw. If the user cancels that dialog, these degrade
 * gracefully (no stored password / nothing remembered) instead of blocking
 * the import — the manual-password field is always still available.
 */
import { getCredential, putCredential, removeCredential } from "@/vault/stronghold";
import { ensureVaultUnlocked } from "@/stores/vaultPrompt.store";
import { pdfPasswordCandidates, type PdfPasswordInputs } from "@/statements/passwordCandidates";
import { candidatesFromLearnedShapes } from "@/statements/passwordPatternLearning";

export type DocumentKind = "bank_statement" | "form16" | "ais" | "tis" | "form26as" | "it_return" | "capital_gains" | "ca_computation";

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function keyFor(kind: DocumentKind, identifier: string): string {
  return `pdfpw:${kind}:${normalize(identifier)}`;
}

export async function getStoredDocumentPassword(kind: DocumentKind, identifier: string): Promise<string | null> {
  if (!identifier.trim()) return null;
  if (!(await ensureVaultUnlocked())) return null;
  const cred = await getCredential(keyFor(kind, identifier));
  return cred?.password || null;
}

/** Call after the user confirms the "remember this password?" prompt. */
export async function rememberDocumentPassword(
  kind: DocumentKind,
  identifier: string,
  password: string,
  label: string,
): Promise<void> {
  if (!identifier.trim() || !password) return;
  if (!(await ensureVaultUnlocked())) return;
  await putCredential(keyFor(kind, identifier), { label, username: "", password });
}

export async function forgetDocumentPassword(kind: DocumentKind, identifier: string): Promise<void> {
  if (!(await ensureVaultUnlocked())) return;
  await removeCredential(keyFor(kind, identifier));
}

/**
 * Builds the password candidate list a document-open attempt should try: the
 * stored password first (if any), then the usual PAN/DOB/account-number
 * guesses, then candidates from any previously-learned patterns
 * (`passwordPatternLearning.ts` — combinations discovered from earlier manual
 * entries that weren't in the built-in guess list), de-duplicated.
 */
export async function candidatesWithStoredPassword(
  kind: DocumentKind,
  identifier: string,
  inputs: PdfPasswordInputs,
): Promise<string[]> {
  const stored = await getStoredDocumentPassword(kind, identifier);
  const guessed = pdfPasswordCandidates(inputs);
  const learned = await candidatesFromLearnedShapes(inputs);
  const all = stored ? [stored, ...guessed, ...learned] : [...guessed, ...learned];
  return Array.from(new Set(all.filter((c) => c.length > 0)));
}
