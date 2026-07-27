import { describe, expect, it } from "vitest";
import { buildDocModel, fromNativeRows } from "@scandoc/core/docmodel";
import { parseAmount } from "./amount";
import { parseStatementDate } from "./parseDate";
import { STATEMENT_DOC_OPTIONS, monthlyBalancesFromTransactions, parseTransactionsFromDoc } from "./pdfStatementImport";
import type { PdfTableRow } from "./types";

function row(rowIndex: number, cells: [string, number][]): PdfTableRow {
  return {
    page_index: 0,
    row_index: rowIndex,
    cells: cells.map(([text, x]) => ({ text, x, width: 20 })),
  };
}

/**
 * The row fixtures are transcriptions of real statement layouts (a glued
 * date+narration cell, mid-word narration wraps, a page footer repeated
 * verbatim, a wrapped cheque reference whose tail digits land in an amount
 * column). They are kept verbatim through the migration to the DocModel
 * pipeline, so a structuring regression surfaces here.
 */
function parseTransactions(rows: PdfTableRow[], institution?: string | null) {
  const model = buildDocModel(
    { doc: fromNativeRows(rows), filename: "statement.pdf", kind: "pdf" },
    { parseNumber: parseAmount, parseDate: parseStatementDate, ...STATEMENT_DOC_OPTIONS },
  );
  return parseTransactionsFromDoc(model, institution);
}

describe("parseTransactions", () => {
  it("parses a clean statement into transactions", () => {
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["01/04/2026", 10], ["Salary credit", 100], ["50000", 280], ["50000", 340]]),
      row(2, [["02/04/2026", 10], ["ATM withdrawal", 100], ["2000", 220], ["48000", 340]]),
    ];

    const { transactions, warnings } = parseTransactions(rows);

    expect(warnings).toEqual([]);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: "2026-04-01",
      description: "Salary credit",
      credit: 50000,
      debit: null,
      balance: 50000,
    });
    expect(transactions[1]).toMatchObject({
      date: "2026-04-02",
      description: "ATM withdrawal",
      debit: 2000,
      credit: null,
      balance: 48000,
    });
  });

  it("splits a date glued to the narration when the table reconstruction merged them into one cell", () => {
    // Simulates a layout where the date and description columns have no more
    // than a normal word-space gap between them, so the raw extraction can't
    // tell them apart geometrically and hands back one merged "date" cell.
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["01/04/2026 SOME MERCHANT PAYMENT REF00001", 10], ["50000", 280], ["50000", 340]]),
    ];

    const { transactions, warnings } = parseTransactions(rows);

    expect(warnings).toEqual([]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      date: "2026-04-01",
      description: "SOME MERCHANT PAYMENT REF00001",
      credit: 50000,
      balance: 50000,
    });
  });

  it("folds a wrapped narration continuation row (no date, no amount) into the previous transaction instead of emitting a phantom row", () => {
    // Long merchant/reference text can overflow one physical line and wrap
    // onto its own row with nothing else on it — this must attach to the
    // transaction above it, not become its own (blank) transaction. The wrap
    // can land mid-word, so no separator is expected between the pieces.
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["01/04/2026", 10], ["SOME MERCHANT SERVICE-CF.DUM", 100], ["50000", 280], ["50000", 340]]),
      row(2, [["MYCOMPANYNAME REF00001", 72]]), // continuation, lands in an unrelated column by x
      row(3, [["02/04/2026", 10], ["ATM withdrawal", 100], ["2000", 220], ["48000", 340]]),
    ];

    const { transactions, warnings } = parseTransactions(rows);

    expect(warnings).toEqual([]);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: "2026-04-01",
      description: "SOME MERCHANT SERVICE-CF.DUMMYCOMPANYNAME REF00001",
      credit: 50000,
      balance: 50000,
    });
    expect(transactions[1]).toMatchObject({ date: "2026-04-02", description: "ATM withdrawal" });
  });

  it("stops folding at the first blank row and never resumes for the unrelated content that follows (e.g. a page's restated customer/letterhead block, separated from the table by a blank row)", () => {
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["01/04/2026", 10], ["Salary credit", 100], ["50000", 280], ["50000", 340]]),
      row(2, [["", 72]]), // blank spacer row, as table reconstruction often inserts between blocks
      row(3, [["SOME CUSTOMER NAME", 72]]),
      row(4, [["SOME ADDRESS LINE", 72]]),
      row(5, [["02/04/2026", 10], ["ATM withdrawal", 100], ["2000", 220], ["48000", 340]]),
    ];

    const { transactions } = parseTransactions(rows);

    expect(transactions).toHaveLength(2);
    expect(transactions[0].description).toBe("Salary credit");
    expect(transactions[1]).toMatchObject({ date: "2026-04-02", description: "ATM withdrawal" });
  });

  it("caps how many consecutive lines fold onto a transaction, so an unrelated multi-line block with no blank-row gap can't corrupt it indefinitely (e.g. a page's restated letterhead running directly into the last transaction)", () => {
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["01/04/2026", 10], ["Salary credit", 100], ["50000", 280], ["50000", 340]]),
      row(2, [["SOME CUSTOMER NAME", 72]]),
      row(3, [["SOME ADDRESS LINE ONE", 72]]),
      row(4, [["SOME ADDRESS LINE TWO", 72]]),
      row(5, [["SOME ADDRESS LINE THREE", 72]]),
      row(6, [["02/04/2026", 10], ["ATM withdrawal", 100], ["2000", 220], ["48000", 340]]),
    ];

    const { transactions } = parseTransactions(rows);

    expect(transactions).toHaveLength(2);
    expect(transactions[0].description).toBe("Salary creditSOME CUSTOMER NAMESOME ADDRESS LINE ONE");
    expect(transactions[1]).toMatchObject({ date: "2026-04-02", description: "ATM withdrawal" });
  });

  it("doesn't treat a row as a real transaction just because SOME text landed in the debit/credit column band — the text must actually parse as an amount (e.g. page-footer boilerplate overlapping the credit column's x-tolerance)", () => {
    // Reproduces a real failure: an address/letterhead line's description
    // text is recognized correctly, but an unrelated fragment (page-footer
    // text like "Page No: 1") from the same reconstructed row also lands
    // within the credit column's x-tolerance without being a number. A
    // presence-only check ("is aligned.credit non-empty?") would wrongly
    // treat this as a real movement and push a phantom transaction with a
    // null amount once parseAmount fails on it.
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["01/04/2026", 10], ["Salary credit", 100], ["50000", 280], ["50000", 340]]),
      row(2, [["SOME ADDRESS LINE", 100], ["Page No: 1", 285]]),
      row(3, [["02/04/2026", 10], ["ATM withdrawal", 100], ["2000", 220], ["48000", 340]]),
    ];

    const { transactions } = parseTransactions(rows);

    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.date)).toEqual(["2026-04-01", "2026-04-02"]);
    // The description text folds onto the previous transaction like any
    // other continuation row; the unparseable "Page No: 1" fragment that
    // landed in the credit band is simply dropped, not glued in as noise —
    // the key assertion is that NEITHER produces its own phantom transaction.
    expect(transactions[0].description).toBe("Salary creditSOME ADDRESS LINE");
  });

  it("drops a dated running-balance marker row (e.g. 'Bal: <amount>') with no debit/credit instead of treating it as a transaction", () => {
    // Some statements print an end-of-day balance restatement line that DOES
    // carry a date but has no actual debit/credit movement — a date alone
    // (or a date plus a bare balance figure) still isn't a real transaction.
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["01/04/2026", 10], ["Salary credit", 100], ["50000", 280], ["50000", 340]]),
      row(2, [["02/04/2026", 10], ["Bal: 50000.00", 100], ["50000", 340]]), // no debit/credit — not a movement
      row(3, [["03/04/2026", 10], ["ATM withdrawal", 100], ["2000", 220], ["48000", 340]]),
    ];

    const { transactions } = parseTransactions(rows);

    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.date)).toEqual(["2026-04-01", "2026-04-03"]);
    // Not folded into the previous transaction's description either — it has
    // its own date, so it isn't leftover wrap text from the row above it.
    expect(transactions[0].description).toBe("Salary credit");
  });

  it("drops a dateless balance-only marker row (e.g. 'Opening Balance') instead of emitting a phantom transaction", () => {
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["Opening Balance", 100], ["50000", 340]]), // no date, no debit/credit — just a balance marker
      row(2, [["01/04/2026", 10], ["Salary credit", 100], ["50000", 280], ["100000", 340]]),
    ];

    const { transactions } = parseTransactions(rows);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ date: "2026-04-01", description: "Salary credit" });
  });

  it("folds a continuation row that's the first row after a page break's repeated header onto the previous page's last transaction", () => {
    // A statement whose header restates at the top of every page produces a
    // NEW table segment there — when a narration wraps right across that
    // page break, its leftover text becomes the new segment's very first
    // data row (no date, no amount) and must still attach to the last
    // transaction from the PREVIOUS page/segment, not be dropped or treated
    // as its own entry.
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["01/04/2026", 10], ["SOME MERCHANT SERVICE-CF.DUM", 100], ["50000", 280], ["50000", 340]]),
      // Page 2 restates the header, starting a new segment.
      row(2, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(3, [["MYCOMPANYNAME REF00001", 72]]), // continuation, first row of the new segment
      row(4, [["02/04/2026", 10], ["ATM withdrawal", 100], ["2000", 220], ["48000", 340]]),
    ];

    const { transactions, warnings } = parseTransactions(rows);

    expect(warnings).toEqual([]);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: "2026-04-01",
      description: "SOME MERCHANT SERVICE-CF.DUMMYCOMPANYNAME REF00001",
    });
    expect(transactions[1]).toMatchObject({ date: "2026-04-02", description: "ATM withdrawal" });
  });

  it("drops a leading continuation-shaped row that has no prior transaction to attach to", () => {
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["stray leftover text", 72]]), // no date, no amount, nothing to attach to yet
      row(2, [["01/04/2026", 10], ["Salary credit", 100], ["50000", 280], ["50000", 340]]),
    ];

    const { transactions } = parseTransactions(rows);

    expect(transactions).toHaveLength(1);
    expect(transactions[0].description).toBe("Salary credit");
  });

  it("doesn't turn a wrapped cheque-reference-number fragment into a phantom transaction, and correctly captures the real debit despite a glued 'Value Dt Withdrawal Amt.' header (real-world regression)", () => {
    // Reduced repro of the exact bug: the header's "Value Dt Withdrawal Amt."
    // cell glues two sub-labels together, so its x sits far from where the
    // actual withdrawal amount renders — and a wrapped cheque-ref number's
    // tail digits ("111222") coincidentally land within point-distance of
    // that same glued header, becoming a phantom transaction while the real
    // debit silently vanished. Cell shapes/x-positions are the real ones
    // from the source document.
    const cell = (text: string, x: number, width = 20) => ({ text, x, width });
    const rows: PdfTableRow[] = [
      {
        page_index: 0,
        row_index: 0,
        cells: [
          cell("Date", 39.9), cell("Narration", 144.183), cell("Chq./Ref.No.", 283.525),
          cell("Value Dt Withdrawal Amt.", 361.503, 104.259), cell("Deposit Amt.", 491.054), cell("Closing Balance", 564.281),
        ],
      },
      {
        page_index: 0,
        row_index: 1,
        cells: [
          cell("01/09/25 NEFT DR-ICIC0001032-ANAMIKA-NETBANK,", 33.681, 202.326),
          cell("HDFCN52025090144 01/09/25", 281.486, 109.461),
          cell("49,950.00", 438.235, 32),
          cell("2,578,824.35", 584.705, 42),
        ],
      },
      { page_index: 0, row_index: 2, cells: [cell("MUM", 68.031, 20)] },
      {
        page_index: 0,
        row_index: 3,
        cells: [cell("-EXBKN00000000000111222-FAMILY", 72.031, 119.992), cell("111222", 328.598, 24)],
      },
      {
        page_index: 0,
        row_index: 4,
        cells: [
          cell("02/09/25 UPI-EXAMPLE MERCHANT ON", 33.681, 120.558),
          cell("0000000000111222 02/09/25", 288.598, 102.349),
          cell("1,000.00", 438.235, 32),
          cell("1,234,567.89", 584.705, 42),
        ],
      },
    ];

    const { transactions } = parseTransactions(rows);

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: "2025-09-01",
      debit: 49950,
      credit: null,
      balance: 2578824.35,
    });
    // The wrapped cheque-ref text ("...111222...") legitimately folds onto the
    // description as narration text — the bug was it becoming a phantom
    // AMOUNT, not the digits appearing in the description at all.
    expect(transactions[1]).toMatchObject({ date: "2025-09-02", debit: 1000, credit: null, balance: 1234567.89 });
    // No phantom third transaction from the wrapped cheque-ref fragment.
    expect(transactions.every((t) => t.debit !== 111222 && t.credit !== 111222)).toBe(true);
  });

  it("excludes a page footer disclaimer that repeats verbatim on every page instead of folding it into the last transaction's description (real-world regression)", () => {
    // one real bank prints "EXAMPLE BANK LIMITED" / "*Closing balance includes funds
    // earmarked..." at the bottom of every page, right after that page's last
    // transaction with no blank-row gap. The fold-count cap alone still let
    // 2 lines of it glue onto whichever transaction happened to be last on
    // each page — across a multi-page statement this happened dozens of
    // times. Because the exact same text repeats on every page, it should be
    // recognized as boilerplate and dropped outright, not folded.
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
      row(1, [["01/04/2026", 10], ["Salary credit", 100], ["50000", 280], ["50000", 340]]),
      row(2, [["EXAMPLE BANK LIMITED", 28]]),
      row(3, [["*Closing balance includes funds earmarked for hold and uncleared funds", 28]]),
      row(4, [["02/04/2026", 10], ["ATM withdrawal", 100], ["2000", 220], ["48000", 340]]),
      row(5, [["EXAMPLE BANK LIMITED", 28]]),
      row(6, [["*Closing balance includes funds earmarked for hold and uncleared funds", 28]]),
      row(7, [["03/04/2026", 10], ["Interest credit", 100], ["100", 280], ["48100", 340]]),
      row(8, [["EXAMPLE BANK LIMITED", 28]]),
      row(9, [["*Closing balance includes funds earmarked for hold and uncleared funds", 28]]),
    ];

    const { transactions } = parseTransactions(rows);

    expect(transactions).toHaveLength(3);
    expect(transactions[0].description).toBe("Salary credit");
    expect(transactions[1].description).toBe("ATM withdrawal");
    expect(transactions[2].description).toBe("Interest credit");
  });

  it("warns when no balance column is found", () => {
    const rows = [row(0, [["Date", 10], ["Description", 100]])];
    const { warnings } = parseTransactions(rows);
    expect(warnings.some((w) => w.includes("balance column"))).toBe(true);
  });

  it("applies an institution's column template and still parses transactions correctly", () => {
    const rows = [
      row(0, [["Date", 10], ["Narration", 100], ["Withdrawal Amt.", 220], ["Deposit Amt.", 280], ["Closing Balance", 340]]),
      row(1, [["01/04/2026", 10], ["Salary credit", 100], ["50000", 280], ["50000", 340]]),
    ];

    const { transactions, warnings, templateApplied } = parseTransactions(rows, "HDFC Bank");

    expect(templateApplied).toBe(true);
    expect(warnings).toEqual([]);
    expect(transactions).toMatchObject([{ credit: 50000, balance: 50000 }]);
  });

  it("reports templateApplied=false with no institution or an unknown one", () => {
    const rows = [
      row(0, [["Date", 10], ["Description", 100], ["Debit", 220], ["Credit", 280], ["Balance", 340]]),
    ];
    expect(parseTransactions(rows).templateApplied).toBe(false);
    expect(parseTransactions(rows, "Some Unknown Bank").templateApplied).toBe(false);
  });
});

describe("monthlyBalancesFromTransactions", () => {
  it("takes the last dated balance per month", () => {
    const balances = monthlyBalancesFromTransactions([
      { date: "2026-04-01", rawDate: "01/04/2026", description: "a", debit: null, credit: 50000, balance: 50000 },
      { date: "2026-04-15", rawDate: "15/04/2026", description: "b", debit: 2000, credit: null, balance: 48000 },
      { date: "2026-05-02", rawDate: "02/05/2026", description: "c", debit: null, credit: 1000, balance: 49000 },
    ]);

    expect(balances).toEqual([
      { month: "2026-04", balance: 48000, asOfDate: "2026-04-15" },
      { month: "2026-05", balance: 49000, asOfDate: "2026-05-02" },
    ]);
  });

  it("skips transactions with no date or no balance", () => {
    const balances = monthlyBalancesFromTransactions([
      { date: null, rawDate: "Opening Balance", description: "", debit: null, credit: null, balance: 1000 },
      { date: "2026-04-01", rawDate: "01/04/2026", description: "a", debit: null, credit: null, balance: null },
    ]);

    expect(balances).toEqual([]);
  });
});
