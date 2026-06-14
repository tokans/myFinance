/**
 * Pure Will logic (Feature 3): nominee-vs-beneficiary reconciliation and a
 * deterministic simple-Will template. No DB/React, no LLM. Tested in will.test.ts.
 */
import type { HoldingLike } from "./nominations";

export interface ReconcileRow {
  account_id: number;
  nomineePersonIds: number[];
  beneficiaryPersonIds: number[];
  /** True when the nominee set equals the Will-beneficiary set for this account. */
  matches: boolean;
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

/**
 * Compare nominees to Will beneficiaries per account. Only accounts that have
 * BOTH a nominee and a beneficiary are returned — those are the ones where a
 * mismatch causes a real dispute (nominee receives custody, beneficiary the
 * legal entitlement).
 */
export function reconcileWillVsNominees(holdings: HoldingLike[]): ReconcileRow[] {
  const byAccount = new Map<number, { nominees: Set<number>; beneficiaries: Set<number> }>();
  for (const h of holdings) {
    const e = byAccount.get(h.account_id) ?? { nominees: new Set<number>(), beneficiaries: new Set<number>() };
    if (h.role === "nominee") e.nominees.add(h.person_id);
    else if (h.role === "beneficiary") e.beneficiaries.add(h.person_id);
    byAccount.set(h.account_id, e);
  }
  const rows: ReconcileRow[] = [];
  for (const [account_id, e] of byAccount) {
    if (e.nominees.size === 0 || e.beneficiaries.size === 0) continue;
    const nomineePersonIds = [...e.nominees].sort((a, b) => a - b);
    const beneficiaryPersonIds = [...e.beneficiaries].sort((a, b) => a - b);
    rows.push({
      account_id,
      nomineePersonIds,
      beneficiaryPersonIds,
      matches: sameSet(nomineePersonIds, beneficiaryPersonIds),
    });
  }
  return rows;
}

export interface WillTemplateInput {
  testatorName: string;
  place?: string;
  date?: string;
  executorName?: string;
  guardianName?: string;
  bequests?: { item: string; toWhom: string }[];
  residuaryTo?: string;
}

const WILL_DISCLAIMER =
  "DISCLAIMER: This is a basic template, not legal advice. For anything beyond a " +
  "simple estate — or to ensure validity, registration, and proper witnessing in your " +
  "jurisdiction — consult a qualified lawyer.";

/** Build a plain-text simple Will. Deterministic; the caller adds witnesses/signatures. */
export function buildSimpleWill(input: WillTemplateInput): string {
  const name = input.testatorName.trim() || "[Your full name]";
  const lines: string[] = [];
  lines.push("LAST WILL AND TESTAMENT");
  lines.push("");
  lines.push(
    `I, ${name}${input.place ? ` of ${input.place}` : ""}, being of sound mind, declare this to be my ` +
      "last Will and Testament, revoking all earlier Wills and codicils.",
  );
  lines.push("");
  if (input.executorName?.trim()) {
    lines.push(`1. EXECUTOR. I appoint ${input.executorName.trim()} as the executor of this Will.`);
  }
  if (input.guardianName?.trim()) {
    lines.push(`2. GUARDIAN. I appoint ${input.guardianName.trim()} as guardian of my minor children.`);
  }
  const bequests = (input.bequests ?? []).filter((b) => b.item.trim() && b.toWhom.trim());
  if (bequests.length) {
    lines.push("3. SPECIFIC BEQUESTS.");
    bequests.forEach((b, i) =>
      lines.push(`   ${String.fromCharCode(97 + i)}. I give ${b.item.trim()} to ${b.toWhom.trim()}.`),
    );
  }
  if (input.residuaryTo?.trim()) {
    lines.push(`4. RESIDUARY ESTATE. I give the rest of my estate to ${input.residuaryTo.trim()}.`);
  }
  lines.push("");
  lines.push(`Signed on ${input.date?.trim() || "[date]"}: ____________________  (${name})`);
  lines.push("");
  lines.push("Witness 1: ____________________    Witness 2: ____________________");
  lines.push("");
  lines.push(WILL_DISCLAIMER);
  return lines.join("\n");
}
