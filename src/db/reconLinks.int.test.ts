import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildSuiteTestDb } from "./__tests__/suiteTestDb";

const h = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("./client", async () => {
  const { T: tables } = await import("./tables");
  return {
    T: tables,
    query: async (sql: string, params: unknown[] = []) =>
      h.db!.prepare(sql).all(...(params as never[])),
    exec: async (sql: string, params: unknown[] = []) => {
      if (params.length) h.db!.prepare(sql).run(...(params as never[]));
      else h.db!.exec(sql);
    },
    getDb: async () => ({
      execute: async (sql: string, params: unknown[] = []) => {
        const r = h.db!.prepare(sql).run(...(params as never[]));
        return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
      },
      select: async (sql: string, params: unknown[] = []) =>
        h.db!.prepare(sql).all(...(params as never[])),
    }),
  };
});

import { upsertTaxYear, insertPayment, insertIncome, listPayments, listPaymentsAll, listIncome, listIncomeAll } from "./tax";
import { createAccount } from "./accounts";
import { insertTransaction, listAllTransactions } from "./transactions";
import {
  upsertSuggestedLinks, listLinksFor, listAllLinks, confirmLink, dismissLink, unconfirmLink, runAutoRecon,
  markManualDuplicates, markSumOfGroup,
} from "./reconLinks";

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

describe("reconLinks", () => {
  it("upsertSuggestedLinks is idempotent — re-running the matcher doesn't duplicate a pending suggestion", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "26AS-PDF", note: null });
    const [a, b] = await listPaymentsAll("AY2026-27");

    await upsertSuggestedLinks([{ a_kind: "tax_payment", a_id: a.id, b_kind: "tax_payment", b_id: b.id }]);
    await upsertSuggestedLinks([{ a_kind: "tax_payment", a_id: a.id, b_kind: "tax_payment", b_id: b.id }]);

    expect(await listAllLinks()).toHaveLength(1);
  });

  it("confirming a duplicate tax_payment pair excludes the loser from listPayments but keeps it in listPaymentsAll", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "26AS-PDF", note: null });
    const [a, b] = await listPaymentsAll("AY2026-27");

    await upsertSuggestedLinks([{ a_kind: "tax_payment", a_id: a.id, b_kind: "tax_payment", b_id: b.id }]);
    const [link] = await listAllLinks();
    await confirmLink(link.id);

    expect(await listPaymentsAll("AY2026-27")).toHaveLength(2);
    expect(await listPayments("AY2026-27")).toHaveLength(1); // the loser (b-side) is excluded from totals
    expect((await listAllLinks())[0].status).toBe("confirmed");
  });

  it("unconfirmLink reverts the exclusion and the link status", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "advance", payer_name: null, amount: 100000, source_path: "AIS-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "advance", payer_name: null, amount: 100000, source_path: "TIS-PDF", note: null });
    const [a, b] = await listPaymentsAll("AY2026-27");
    await upsertSuggestedLinks([{ a_kind: "tax_payment", a_id: a.id, b_kind: "tax_payment", b_id: b.id }]);
    const [link] = await listAllLinks();

    await confirmLink(link.id);
    expect(await listPayments("AY2026-27")).toHaveLength(1);

    await unconfirmLink(link.id);
    expect(await listPayments("AY2026-27")).toHaveLength(2);
    expect((await listAllLinks())[0].status).toBe("suggested");
  });

  it("confirming a transaction<->tax_payment match only changes status, never excludes anything", async () => {
    await upsertTaxYear("AY2026-27");
    const accountId = await createAccount({ name: "Acct", type: "bank_savings", institution: null, currency: "INR", opening_balance: 0 });
    await insertTransaction({ account_id: accountId, date: "2026-03-11", raw_date: "11/03/2026", description: "Advance tax", debit: 200000, credit: null, balance: null, source_path: "STATEMENT:x" });
    await insertPayment({ ay: "AY2026-27", type: "advance", payer_name: null, amount: 200000, source_path: "AIS-PDF", note: null });
    const [txn] = await listAllTransactions();
    const [payment] = await listPaymentsAll("AY2026-27");

    await upsertSuggestedLinks([{ a_kind: "transaction", a_id: txn.id, b_kind: "tax_payment", b_id: payment.id }]);
    const [link] = await listAllLinks();
    await confirmLink(link.id);

    expect((await listAllLinks())[0].status).toBe("confirmed");
    expect(await listPayments("AY2026-27")).toHaveLength(1); // untouched — no duplicate-pair exclusion logic applies

    const found = await listLinksFor("transaction", txn.id);
    expect(found).toHaveLength(1);
  });

  it("dismissLink marks a candidate reviewed without excluding anything", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "26AS-PDF", note: null });
    const [a, b] = await listPaymentsAll("AY2026-27");
    await upsertSuggestedLinks([{ a_kind: "tax_payment", a_id: a.id, b_kind: "tax_payment", b_id: b.id }]);
    const [link] = await listAllLinks();

    await dismissLink(link.id);

    expect((await listAllLinks())[0].status).toBe("dismissed");
    expect(await listPayments("AY2026-27")).toHaveLength(2);
  });
});

describe("runAutoRecon", () => {
  it("auto-confirms an exact-amount duplicate payment across two documents, excluding the loser", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "26AS-PDF", note: null });

    await runAutoRecon("AY2026-27");

    expect(await listPayments("AY2026-27")).toHaveLength(1); // loser excluded from totals
    expect(await listPaymentsAll("AY2026-27")).toHaveLength(2); // but not deleted
    expect((await listAllLinks())[0].status).toBe("confirmed");
  });

  it("auto-confirms an exact-amount duplicate income row across two documents", async () => {
    await upsertTaxYear("AY2026-27");
    await insertIncome({ ay: "AY2026-27", head: "dividend", label: "Dividend from XYZ AMC", amount: 5000, source_path: "AIS-PDF", note: null });
    await insertIncome({ ay: "AY2026-27", head: "dividend", label: "Dividend from XYZ AMC", amount: 5000, source_path: "TIS-PDF", note: null });

    await runAutoRecon("AY2026-27");

    expect(await listIncome("AY2026-27")).toHaveLength(1);
    expect(await listIncomeAll("AY2026-27")).toHaveLength(2);
  });

  it("leaves a close-but-not-identical amount as a suggested discrepancy, excluding neither side", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 499500, source_path: "26AS-PDF", note: null });

    await runAutoRecon("AY2026-27");

    expect(await listPayments("AY2026-27")).toHaveLength(2); // neither side excluded
    const [link] = await listAllLinks();
    expect(link.status).toBe("suggested");
    expect(link.note).toBe("discrepancy");
  });

  it("never resurrects a pair the user explicitly rejected (undo, then dismiss), even though it's an exact match", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "26AS-PDF", note: null });

    await runAutoRecon("AY2026-27"); // auto-confirms the exact match
    const [link] = await listAllLinks();
    await unconfirmLink(link.id); // user disagrees with the auto-exclude and undoes it
    await dismissLink(link.id); // ...and rejects the pairing outright

    await runAutoRecon("AY2026-27"); // re-run, as would happen on every page load

    expect((await listAllLinks())[0].status).toBe("dismissed");
    expect(await listPayments("AY2026-27")).toHaveLength(2); // still not excluded
  });

  it("is idempotent — re-running after a confirm doesn't error or double-link", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "26AS-PDF", note: null });

    await runAutoRecon("AY2026-27");
    await runAutoRecon("AY2026-27");

    expect(await listAllLinks()).toHaveLength(1);
    expect(await listPayments("AY2026-27")).toHaveLength(1);
  });

  it("auto-maps a ₹75,000 salary gap to the standard deduction, excluding the GROSS (higher) figure", async () => {
    await upsertTaxYear("AY2026-27");
    await insertIncome({ ay: "AY2026-27", head: "salary", label: "Salary income (Form 16 Part B item 6)", amount: 1600000, source_path: "Form16-PDF", note: null });
    await insertIncome({ ay: "AY2026-27", head: "salary", label: "Salary received (Section 192)", amount: 1675000, source_path: "AIS-PDF", note: null });

    const result = await runAutoRecon("AY2026-27");

    expect(result.standardDeductionMapped).toBe(1);
    expect(result.autoConfirmed).toBe(0);
    const remaining = await listIncome("AY2026-27");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].amount).toBe(1600000); // the net (Form 16) figure survives, not the gross AIS one
    const [link] = await listAllLinks();
    expect(link.status).toBe("confirmed");
    expect(link.note).toBe("standard_deduction");
  });

  it("collapses a THREE-way same-amount salary duplicate (three documents, including a same-document repeat) to one survivor", async () => {
    await upsertTaxYear("AY2026-27");
    await insertIncome({ ay: "AY2026-27", head: "salary", label: "Salary income (Form 16 Part B item 6)", amount: 1600000, source_path: "Form16-PDF", note: null });
    await insertIncome({ ay: "AY2026-27", head: "salary", label: "Salary received (Section 192)", amount: 1600000, source_path: "AIS-PDF", note: null });
    // a same-document repeat (e.g. a table row parsed twice) — also part of the group.
    await insertIncome({ ay: "AY2026-27", head: "salary", label: "Salary received (Section 192)", amount: 1600000, source_path: "AIS-PDF", note: null });

    const result = await runAutoRecon("AY2026-27");

    expect(result.autoConfirmed).toBe(3); // 3 pairwise links among the 3 rows
    expect(await listIncomeAll("AY2026-27")).toHaveLength(3); // nothing deleted
    const remaining = await listIncome("AY2026-27");
    expect(remaining).toHaveLength(1); // but only one counts toward totals
    expect(remaining[0].source_path).toBe("Form16-PDF"); // the earliest-inserted row survives
  });

  it("returns separate counts for exact matches, standard-deduction mappings and discrepancies", async () => {
    await upsertTaxYear("AY2026-27");
    // exact
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "26AS-PDF", note: null });
    // standard deduction
    await insertIncome({ ay: "AY2026-27", head: "salary", label: "Salary income (Form 16 Part B item 6)", amount: 1600000, source_path: "Form16-PDF", note: null });
    await insertIncome({ ay: "AY2026-27", head: "salary", label: "Salary received (Section 192)", amount: 1675000, source_path: "AIS-PDF", note: null });
    // discrepancy
    await insertIncome({ ay: "AY2026-27", head: "dividend", label: "Dividend from XYZ AMC", amount: 5000, source_path: "AIS-PDF", note: null });
    await insertIncome({ ay: "AY2026-27", head: "dividend", label: "Dividend from XYZ AMC", amount: 5080, source_path: "TIS-PDF", note: null });

    const result = await runAutoRecon("AY2026-27");

    expect(result).toEqual({ autoConfirmed: 1, standardDeductionMapped: 1, discrepancies: 1 });
  });
});

describe("confirmLink with a reason", () => {
  it("accepting a discrepancy with a reason overwrites the link's note with that reason", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 499500, source_path: "26AS-PDF", note: null });

    await runAutoRecon("AY2026-27"); // leaves it 'suggested' with note 'discrepancy'
    const [link] = await listAllLinks();
    expect(link.note).toBe("discrepancy");

    await confirmLink(link.id, "26AS not yet updated for Q4");

    const [confirmed] = await listAllLinks();
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.note).toBe("26AS not yet updated for Q4");
    expect(await listPayments("AY2026-27")).toHaveLength(1); // the b-side loser is excluded, same as any confirm
  });

  it("auto-confirm tiers keep their machine-tag note untouched (no reason passed)", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "Form16-PDF", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_salary", payer_name: "Employer", amount: 500000, source_path: "26AS-PDF", note: null });

    await runAutoRecon("AY2026-27");

    const [link] = await listAllLinks();
    expect(link.note).toBe("exact");
  });

  it("unconfirmLink on a standard-deduction pair restores the excluded (higher) side regardless of a/b position", async () => {
    await upsertTaxYear("AY2026-27");
    await insertIncome({ ay: "AY2026-27", head: "salary", label: "Salary income (Form 16 Part B item 6)", amount: 1600000, source_path: "Form16-PDF", note: null });
    await insertIncome({ ay: "AY2026-27", head: "salary", label: "Salary received (Section 192)", amount: 1675000, source_path: "AIS-PDF", note: null });

    await runAutoRecon("AY2026-27");
    expect(await listIncome("AY2026-27")).toHaveLength(1);

    const [link] = await listAllLinks();
    await unconfirmLink(link.id);

    expect(await listIncome("AY2026-27")).toHaveLength(2); // both back in totals
    expect((await listAllLinks())[0].status).toBe("suggested");
  });
});

describe("markManualDuplicates", () => {
  it("excludes every marked row except the one kept, with a default note when no reason is given", async () => {
    await upsertTaxYear("AY2026-27");
    // deliberately something the automatic matcher would NOT catch on its own (unrecognized
    // source, so `suggestDuplicateIncomeLinks` would never generate a candidate for these).
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest — Bank A", amount: 12345, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest — Bank B", amount: 12345, source_path: "MANUAL:edit", note: null });
    const [a, b] = await listIncomeAll("AY2026-27");

    await markManualDuplicates("tax_income", a.id, [b.id]);

    expect(await listIncome("AY2026-27")).toHaveLength(1);
    expect((await listIncome("AY2026-27"))[0].id).toBe(a.id);
    const [link] = await listAllLinks();
    expect(link.status).toBe("confirmed");
    expect(link.note).toBe("manual");
  });

  it("stores a custom reason when given", async () => {
    await upsertTaxYear("AY2026-27");
    await insertPayment({ ay: "AY2026-27", type: "tds_other", payer_name: "Broker X", amount: 900, source_path: "MANUAL:edit", note: null });
    await insertPayment({ ay: "AY2026-27", type: "tds_other", payer_name: "Broker X (dup)", amount: 900, source_path: "MANUAL:edit", note: null });
    const [a, b] = await listPaymentsAll("AY2026-27");

    await markManualDuplicates("tax_payment", a.id, [b.id], "Same broker, split across two statement pages");

    const [link] = await listAllLinks();
    expect(link.note).toBe("Same broker, split across two statement pages");
  });

  it("marks a whole group at once, keeping exactly one survivor", async () => {
    await upsertTaxYear("AY2026-27");
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest A", amount: 500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest B", amount: 500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest C", amount: 500, source_path: "MANUAL:edit", note: null });
    const [a, b, c] = await listIncomeAll("AY2026-27");

    await markManualDuplicates("tax_income", a.id, [b.id, c.id]);

    expect(await listIncome("AY2026-27")).toHaveLength(1);
    expect(await listIncomeAll("AY2026-27")).toHaveLength(3); // nothing deleted
    expect(await listAllLinks()).toHaveLength(2); // a-b and a-c
  });

  it("is undoable via unconfirmLink, same as any other confirmed pair", async () => {
    await upsertTaxYear("AY2026-27");
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest A", amount: 500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest B", amount: 500, source_path: "MANUAL:edit", note: null });
    const [a, b] = await listIncomeAll("AY2026-27");

    await markManualDuplicates("tax_income", a.id, [b.id]);
    expect(await listIncome("AY2026-27")).toHaveLength(1);

    const [link] = await listAllLinks();
    await unconfirmLink(link.id);

    expect(await listIncome("AY2026-27")).toHaveLength(2);
  });
});

describe("markSumOfGroup", () => {
  it("keeps the aggregate and excludes every detail row, with the default sum-group note", async () => {
    await upsertTaxYear("AY2026-27");
    // 4 quarterly interest entries (AIS) that sum to one annual total (26AS/bank statement).
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest Q1", amount: 2500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest Q2", amount: 2500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest Q3", amount: 2500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest Q4", amount: 2500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest — annual total", amount: 10000, source_path: "MANUAL:edit", note: null });
    const [q1, q2, q3, q4, total] = await listIncomeAll("AY2026-27");

    await markSumOfGroup("tax_income", [total.id], [q1.id, q2.id, q3.id, q4.id]);

    const remaining = await listIncome("AY2026-27");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(total.id);
    expect(remaining[0].amount).toBe(10000); // total counted once, not the 20,000 double-count
    expect(await listAllLinks()).toHaveLength(4); // total<->each quarter
    for (const link of await listAllLinks()) expect(link.note).toBe("sum_group");
  });

  it("can instead keep the itemized detail rows and exclude just the redundant aggregate", async () => {
    await upsertTaxYear("AY2026-27");
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest Q1", amount: 2500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest Q2", amount: 2500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest — annual total", amount: 5000, source_path: "MANUAL:edit", note: null });
    const [q1, q2, total] = await listIncomeAll("AY2026-27");

    await markSumOfGroup("tax_income", [q1.id, q2.id], [total.id], "Prefer the quarterly breakdown for audit");

    const remaining = await listIncome("AY2026-27");
    expect(remaining.map((r) => r.id).sort()).toEqual([q1.id, q2.id].sort());
    expect(remaining.reduce((s, r) => s + r.amount, 0)).toBe(5000); // still counted once
    const links = await listAllLinks();
    expect(links).toHaveLength(2); // q1<->total and q2<->total
    for (const link of links) expect(link.note).toBe("Prefer the quarterly breakdown for audit");
  });

  it("is undoable via unconfirmLink", async () => {
    await upsertTaxYear("AY2026-27");
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest Q1", amount: 2500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest Q2", amount: 2500, source_path: "MANUAL:edit", note: null });
    await insertIncome({ ay: "AY2026-27", head: "other_sources", label: "Interest — annual total", amount: 5000, source_path: "MANUAL:edit", note: null });
    const [q1, q2, total] = await listIncomeAll("AY2026-27");

    await markSumOfGroup("tax_income", [total.id], [q1.id, q2.id]);
    expect(await listIncome("AY2026-27")).toHaveLength(1);

    const links = await listAllLinks();
    for (const link of links) await unconfirmLink(link.id);

    expect(await listIncome("AY2026-27")).toHaveLength(3); // everything back in totals
  });
});
