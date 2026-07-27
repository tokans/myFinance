/**
 * Parse a *decrypted* AIS JSON (Income-Tax portal AIS Utility format, jsonVersion
 * 15.x) into the app's tax income + payment rows, to prefill an assessment year.
 *
 * Real AIS layout (verified against a live file):
 *   metadata.loggedInPan                         → PAN
 *   header.columnData[0]                          → financial year, e.g. "2025-26"
 *   partB.sections[]                              → { sectionKey, heading, elements[] }
 *     element.l2 = { columnLabel:[…], columnData:[[…]] }   ← summary rows per source
 *        columns: Information Category | Code | Description | Source | Count |
 *                 Amount | Information Category Code | Derived Amount | Qualifies For
 *     element.l1 = { columnLabel:[{field,name}…], columnData:[[…]] } ← transactions
 *        fields incl. amtPaid | amountDeducted ("TDS Deducted") | amountDeposited
 *
 * We take income + TDS from the `tdsTcs` section (Part B1) only. The `sft`
 * section reports the SAME dividends/interest from a different source, so
 * summing both would double-count — it is intentionally skipped for income/TDS
 * purposes. Columns are located by their label (not a fixed index) so minor
 * schema shifts don't break.
 *
 * The `sft` section IS additionally captured on its own (`result.sft`) — kept
 * structurally separate from `income`/`payments` — so it can be cross-checked
 * against the bank transaction ledger (large-value transactions banks/registrars
 * report to the tax department: big cash deposits, mutual fund purchases,
 * property registration, etc.), see `domain/sftCrossCheck.ts`. This is purely
 * additive: it never feeds `incomeByHead`/`payByKey`.
 *
 * Every emitted row's source_path starts with `AIS:` so AIS rows can be replaced
 * independently of ITR-import rows (see clearRowsBySourcePrefix in db/tax.ts).
 */

import type { IncomeHead, PaymentType } from "@/db/tax";

export interface AisIncomeRow {
  head: IncomeHead;
  label: string;
  amount: number;
  source_path: string;
}

export interface AisPaymentRow {
  type: PaymentType;
  payer_name: string | null;
  amount: number;
  source_path: string;
}

/** One SFT (Statement of Financial Transaction) summary row — a large-value
 *  transaction reported to the tax department by a bank/registrar/AMC, kept
 *  separate from income/payments (see the module doc comment). */
export interface AisSftRow {
  /** e.g. "SFT-005" ("Information Code" column). */
  sftCode: string;
  /** "Information Description" (falls back to "Information Category"/element title). */
  description: string;
  /** "Information Source" — the reporting bank/registrar/AMC name, or null. */
  reportingEntity: string | null;
  amount: number;
  /** SFT summary rows are usually FY-level aggregates with no single transaction date. */
  date: string | null;
}

export interface AisParseResult {
  ay: string | null;
  pan: string | null;
  income: AisIncomeRow[];
  payments: AisPaymentRow[];
  sft: AisSftRow[];
  /** Summary rows read from the TDS/TCS section. */
  recordCount: number;
  /** Rows with an amount we couldn't classify into an income head. */
  unmappedCount: number;
  /** Payments with no payer/deductor name (AIS's "Information Source" was
   *  blank) — they'll display as "(unnamed)"; surfaced so a bad AIS export
   *  is visible rather than silently swallowed. */
  unnamedPayerCount: number;
}

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined;
}

/** Parse an AIS money string ("12,34,567.00") or number to a number. */
function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Index of the first label that equals (then contains) one of `names`. */
function labelIndex(labels: string[], names: string[]): number {
  const lower = labels.map((l) => l.toLowerCase());
  for (const want of names) {
    const i = lower.indexOf(want.toLowerCase());
    if (i >= 0) return i;
  }
  for (const want of names) {
    const i = lower.findIndex((l) => l.includes(want.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}

/** l1 columns are `{ field, name }` objects; find one by field or name. */
function fieldIndex(cols: unknown[], fields: string[], names: string[]): number {
  for (let i = 0; i < cols.length; i++) {
    const c = asObj(cols[i]);
    const field = asString(c?.field)?.toLowerCase();
    const name = asString(c?.name)?.toLowerCase();
    if (field && fields.some((f) => f.toLowerCase() === field)) return i;
    if (name && names.some((n) => name.includes(n.toLowerCase()))) return i;
  }
  return -1;
}

/** Map an AIS category code / label to an income head (null = don't guess). */
function classifyIncome(code: string | null, category: string): IncomeHead | null {
  const c = (code ?? "").toUpperCase();
  const s = category.toLowerCase();
  if (c === "SAL" || /salary|pension/.test(s)) return "salary";
  if (c === "DIV" || /dividend/.test(s)) return "dividend";
  if (c === "IND" || /interest/.test(s)) return "other_sources";
  if (/business|receipts|professional/.test(s)) return "business";
  if (/rent|house\s*prop/.test(s)) return "house_property";
  return null;
}

/** FY "2025-26" → AY "2026-27" (income of FY N is assessed in AY N+1). */
export function fyToAy(fy: string): string | null {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return /^\d{4}-\d{2}$/.test(fy) ? fy : null;
  const start = Number(m[1]) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function parseAisJson(json: unknown): AisParseResult {
  const root = asObj(json) ?? {};
  const meta = asObj(root.metadata);
  const header = asObj(root.header);
  const partB = asObj(root.partB);

  const fy = asString((header?.columnData as unknown[] | undefined)?.[0]);
  const result: AisParseResult = {
    ay: fy ? fyToAy(fy) : null,
    pan: asString(meta?.loggedInPan),
    income: [],
    payments: [],
    sft: [],
    recordCount: 0,
    unmappedCount: 0,
    unnamedPayerCount: 0,
  };

  const incomeByHead = new Map<IncomeHead, number>();
  const payByKey = new Map<string, { type: PaymentType; payer: string | null; amount: number }>();

  const sections = (partB?.sections as unknown[] | undefined) ?? [];
  for (const secRaw of sections) {
    const sec = asObj(secRaw);
    // Only Part B1 (TDS/TCS) — carries income AND the linked TDS; SFT would double-count.
    if (asString(sec?.sectionKey) !== "tdsTcs") continue;
    const elements = (sec?.elements as unknown[] | undefined) ?? [];

    for (const elRaw of elements) {
      const el = asObj(elRaw);
      const l2 = asObj(el?.l2);
      const labels = ((l2?.columnLabel as unknown[] | undefined) ?? []).map((x) => asString(x) ?? "");
      const rows = (l2?.columnData as unknown[] | undefined) ?? [];
      if (labels.length === 0 || rows.length === 0) continue;

      const iCat = labelIndex(labels, ["Information Category"]);
      const iCatCode = labelIndex(labels, ["Information Category Code"]);
      const iAmt = labelIndex(labels, ["Amount"]); // exact "Amount", not "Derived Amount"
      const iSrc = labelIndex(labels, ["Information Source"]);

      // Sum TDS deducted from the per-transaction detail (l1), if present.
      // AIS keeps superseded/corrected transactions in the same list flagged
      // `status = "Inactive"`; only "Active" rows count, else TDS double-counts
      // (verified: skipping this matches the deductor totals exactly).
      let tds = 0;
      const l1 = asObj(el?.l1);
      const l1cols = (l1?.columnLabel as unknown[] | undefined) ?? [];
      const l1rows = (l1?.columnData as unknown[] | undefined) ?? [];
      const iDed = fieldIndex(l1cols, ["amountDeducted"], ["tds deducted", "tax deducted"]);
      const iStatus = fieldIndex(l1cols, ["status"], ["status"]);
      if (iDed >= 0) {
        for (const r of l1rows) {
          if (!Array.isArray(r)) continue;
          const status = iStatus >= 0 ? asString(r[iStatus]) : null;
          if (status && status.toLowerCase() !== "active") continue;
          tds += asNumber(r[iDed]) ?? 0;
        }
      }

      for (const r of rows) {
        if (!Array.isArray(r)) continue;
        result.recordCount++;
        const category = asString(r[iCat]) ?? asString(el?.title) ?? "";
        const code = asString(r[iCatCode]);
        const amount = asNumber(r[iAmt]);
        const source = asString(r[iSrc]);

        const head = classifyIncome(code, category);
        if (head && amount) incomeByHead.set(head, (incomeByHead.get(head) ?? 0) + amount);
        else if (amount) result.unmappedCount++;

        if (tds > 0) {
          const type: PaymentType = head === "salary" || /salary/i.test(category) ? "tds_salary" : "tds_other";
          const key = `${type} ${source ?? ""}`;
          const prev = payByKey.get(key);
          if (prev) prev.amount += tds;
          else payByKey.set(key, { type, payer: source, amount: tds });
          tds = 0; // one l1 block per element; don't re-add across summary rows
        }
      }
    }
  }

  // SFT section: same l2 summary-row shape as tdsTcs, but captured into its OWN
  // list (never incomeByHead/payByKey — see the module doc comment on why).
  for (const secRaw of sections) {
    const sec = asObj(secRaw);
    if (asString(sec?.sectionKey) !== "sft") continue;
    const elements = (sec?.elements as unknown[] | undefined) ?? [];

    for (const elRaw of elements) {
      const el = asObj(elRaw);
      const l2 = asObj(el?.l2);
      const labels = ((l2?.columnLabel as unknown[] | undefined) ?? []).map((x) => asString(x) ?? "");
      const rows = (l2?.columnData as unknown[] | undefined) ?? [];
      if (labels.length === 0 || rows.length === 0) continue;

      const iCode = labelIndex(labels, ["Information Code"]);
      const iDesc = labelIndex(labels, ["Information Description"]);
      const iCat = labelIndex(labels, ["Information Category"]);
      const iAmt = labelIndex(labels, ["Amount"]);
      const iSrc = labelIndex(labels, ["Information Source"]);

      for (const r of rows) {
        if (!Array.isArray(r)) continue;
        const amount = asNumber(r[iAmt]);
        if (!amount) continue;
        result.sft.push({
          sftCode: asString(r[iCode]) ?? "",
          description: asString(r[iDesc]) ?? asString(r[iCat]) ?? asString(el?.title) ?? "",
          reportingEntity: asString(r[iSrc]),
          amount,
          date: null,
        });
      }
    }
  }

  // Advance / self-assessment tax challans (paymentOfTaxes section). Unlike the
  // TDS section, its elements carry columnLabel/columnData directly (no l2).
  for (const secRaw of sections) {
    const sec = asObj(secRaw);
    if (asString(sec?.sectionKey) !== "paymentOfTaxes") continue;
    for (const elRaw of (sec?.elements as unknown[] | undefined) ?? []) {
      const el = asObj(elRaw);
      const labels = ((el?.columnLabel as unknown[] | undefined) ?? []).map((x) => asString(x) ?? "");
      const rows = (el?.columnData as unknown[] | undefined) ?? [];
      if (!labels.length || !rows.length) continue;
      const iMinor = labelIndex(labels, ["Minor Head"]);
      const iTotal = labelIndex(labels, ["Total (A+B+C+D)", "Total"]);
      for (const r of rows) {
        if (!Array.isArray(r)) continue;
        const amount = asNumber(r[iTotal]);
        if (!amount) continue;
        const minor = (asString(r[iMinor]) ?? "").toLowerCase();
        const type: PaymentType = /self[\s-]*assessment/.test(minor) ? "self_assessment" : "advance";
        const key = `${type} `;
        const prev = payByKey.get(key);
        if (prev) prev.amount += amount;
        else payByKey.set(key, { type, payer: null, amount });
      }
    }
  }

  const HEAD_LABEL: Record<IncomeHead, string> = {
    salary: "Salary / pension (AIS)",
    house_property: "House property — rent (AIS)",
    other_sources: "Interest / other (AIS)",
    dividend: "Dividend (AIS)",
    business: "Business / professional receipts (AIS)",
    cg_short: "Short-term capital gains (AIS)",
    cg_long: "Long-term capital gains (AIS)",
    exempt: "Exempt income (AIS)",
  };
  for (const [head, amount] of incomeByHead) {
    result.income.push({ head, label: HEAD_LABEL[head], amount, source_path: `AIS:income.${head}` });
  }
  for (const p of payByKey.values()) {
    // "advance"/"self_assessment" challans are payments TO the government and
    // never carry a deductor/payer name — only TDS/TCS rows are expected to.
    if (!p.payer?.trim() && (p.type === "tds_salary" || p.type === "tds_other" || p.type === "tcs")) {
      result.unnamedPayerCount++;
    }
    result.payments.push({ type: p.type, payer_name: p.payer, amount: p.amount, source_path: `AIS:payment.${p.type}` });
  }
  return result;
}
