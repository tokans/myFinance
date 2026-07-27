/**
 * Imports an IT-Return document — ITR-V acknowledgment, intimation order
 * (u/s 143(1)), or similar e-filing portal PDF, conventionally
 * password-protected with PAN + date of birth. Unlike Form 16/26AS/AIS/TIS,
 * these documents don't have a single well-known table shape worth extracting
 * figures from (an acknowledgment is mostly free-form text; an intimation
 * order's computation table varies) — so this only verifies the password and
 * stores the document securely (reusing the existing encrypted-document
 * vault, `@/db/documents`'s `addDocumentWithFile`), the same trust boundary
 * every other attached document (Will, PoA, insurance policy, ...) already
 * gets. No figures are extracted or fed into tax computation from this path.
 */
import { addDocumentWithFile } from "@/db/documents";
import { writeDebugDump } from "@/lib/debugDump";
import { createParseLog, type ParseLogEntry } from "@/lib/parseLog";
import { openDocument } from "@/statements/documentIntake";

export interface ItReturnPreview {
  passwordUsed: string | null;
  log: ParseLogEntry[];
}

/** Verifies the document opens (trying `passwordCandidates`) without extracting
 *  any figures — just confirms it's readable before offering to store it. */
export async function previewItReturn(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
): Promise<ItReturnPreview> {
  const log = createParseLog();
  const opened = await openDocument(bytes, filename, passwordCandidates, log);
  log.log("it_return", "document verified — no figures are extracted from IT-return documents, only stored");
  // The structured model goes to the diagnostic dump even though nothing is
  // extracted from it: when a user reports "my ITR-V wouldn't import", the
  // question is always whether the document was READ at all, and previously
  // the dump for this path recorded no content whatsoever to answer that.
  void writeDebugDump("it-return", {
    filename,
    passwordUsed: opened.passwordUsed,
    model: opened.model,
    log: opened.log,
  });
  return { passwordUsed: opened.passwordUsed, log: opened.log };
}

/** Stores the original uploaded bytes as an encrypted document attachment. */
export async function commitItReturn(bytes: Uint8Array, title: string, ay: string): Promise<number> {
  return addDocumentWithFile({ type: "tax_return", title, notes: `Assessment year ${ay}` }, bytes);
}
