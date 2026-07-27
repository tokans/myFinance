/**
 * Decrypts password-protected Excel workbooks (xlsx agile/ECMA-376, legacy xls
 * RC4/BIFF) before handing plain bytes to the existing SheetJS import pipeline
 * (`@/excel/parse`'s `readWorkbook`). Uses the same `officecrypto-tool`
 * dependency + `Buffer` polyfill (`backupVite()` in vite.config.ts) already
 * shipped for encrypted backup import — same bundler wiring, already proven in
 * production, just a separate thin wrapper (see note on `isEncryptedWorkbook` below).
 *
 * Deliberately does NOT reuse `sharedcorelib/backup`'s `isEncryptedWorkbook`:
 * that check is a bare OLE/CFB magic-byte test, correct for its own use case
 * (that engine only ever produces `.xlsx`, so "is CFB" == "is our encrypted
 * wrapper"). Here `.xls` is also a valid *unencrypted* input — a plain legacy
 * `.xls` is ALSO an OLE/CFB container, so the bare signature check would
 * falsely flag every ordinary `.xls` upload as password-protected. Instead
 * this uses `officecrypto-tool`'s own `isEncrypted()`, which actually parses
 * the CFB directory for an `EncryptionInfo` stream (OOXML) or a BIFF
 * `FILEPASS` record in the `Workbook`/`Book` stream (legacy), so a plain
 * `.xls` correctly comes back `false`.
 */
interface OfficeCryptoLike {
  isEncrypted(input: Buffer): boolean;
  decrypt(input: Buffer, opts: { password: string }): Promise<Buffer> | Buffer;
}

function toBuffer(bytes: Uint8Array): Buffer {
  if (typeof Buffer === "undefined") {
    throw new Error("Password-protected Excel files need a Buffer polyfill in this runtime.");
  }
  return Buffer.from(bytes);
}

async function loadOfficeCrypto(): Promise<OfficeCryptoLike> {
  const mod = (await import("officecrypto-tool")) as unknown as { default?: unknown; decrypt?: unknown };
  return (typeof mod.decrypt === "function" ? mod : mod.default) as OfficeCryptoLike;
}

/** True if `bytes` is a genuinely password-protected xlsx or xls (not just any OLE/CFB file). */
export async function isEncryptedWorkbook(bytes: Uint8Array): Promise<boolean> {
  const officeCrypto = await loadOfficeCrypto();
  return officeCrypto.isEncrypted(toBuffer(bytes));
}

/** Decrypts one password-protected workbook's raw bytes. Throws on a wrong password. */
export async function decryptWorkbookBytes(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const officeCrypto = await loadOfficeCrypto();
  const decrypted = await officeCrypto.decrypt(toBuffer(bytes), { password });
  return new Uint8Array(decrypted);
}

/**
 * Tries each candidate password in order against an encrypted workbook.
 * Returns the bytes unchanged (and `passwordUsed: null`) if the workbook isn't
 * encrypted at all. Throws `DocumentPasswordRequiredError` if none match.
 */
export async function decryptWorkbookWithCandidates(
  bytes: Uint8Array,
  candidates: string[],
): Promise<{ bytes: Uint8Array; passwordUsed: string | null }> {
  if (!(await isEncryptedWorkbook(bytes))) return { bytes, passwordUsed: null };

  for (const candidate of candidates) {
    try {
      const decrypted = await decryptWorkbookBytes(bytes, candidate);
      return { bytes: decrypted, passwordUsed: candidate };
    } catch {
      // Wrong password — try the next candidate.
    }
  }

  const { DocumentPasswordRequiredError } = await import("./types");
  throw new DocumentPasswordRequiredError();
}
