import { describe, expect, it } from "vitest";
import { alignRowToColumns, detectTableSegments, findBoilerplateRows } from "./columnSnap";
import type { PdfTableRow } from "./types";

function row(rowIndex: number, cells: [string, number][]): PdfTableRow {
  return {
    page_index: 0,
    row_index: rowIndex,
    cells: cells.map(([text, x]) => ({ text, x, width: 20 })),
  };
}

type Kind = "a" | "b";
function classify(text: string): Kind | null {
  const t = text.trim().toLowerCase();
  if (t === "cola") return "a";
  if (t === "colb") return "b";
  return null;
}

describe("detectTableSegments", () => {
  it("finds a single segment spanning the whole table when there's one header", () => {
    const rows = [
      row(0, [["ColA", 10], ["ColB", 100]]),
      row(1, [["v1", 10], ["v2", 100]]),
      row(2, [["v3", 10], ["v4", 100]]),
    ];

    const segments = detectTableSegments(rows, classify);

    expect(segments).toHaveLength(1);
    expect(segments[0].headerRowIndex).toBe(0);
    expect(segments[0].endRowIndex).toBe(3);
  });

  it("splits into independent segments when a second header appears mid-document", () => {
    const rows = [
      row(0, [["ColA", 10], ["ColB", 100]]),
      row(1, [["v1", 10], ["v2", 100]]),
      row(2, [["ColA", 10], ["ColB", 100]]), // a second table's header, e.g. Part A1
      row(3, [["v3", 10], ["v4", 100]]),
      row(4, [["v5", 10], ["v6", 100]]),
    ];

    const segments = detectTableSegments(rows, classify);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ headerRowIndex: 0, endRowIndex: 2 });
    expect(segments[1]).toMatchObject({ headerRowIndex: 2, endRowIndex: 5 });
  });

  it("each segment aligns its own data rows independently", () => {
    const rows = [
      row(0, [["ColA", 10], ["ColB", 100]]),
      row(1, [["v1", 10], ["v2", 100]]),
      row(2, [["ColA", 10], ["ColB", 100]]),
      row(3, [["v3", 10], ["v4", 100]]),
    ];

    const segments = detectTableSegments(rows, classify);
    const dataRow1 = alignRowToColumns(rows[1], segments[0].columns);
    const dataRow2 = alignRowToColumns(rows[3], segments[1].columns);

    expect(dataRow1).toEqual({ a: "v1", b: "v2" });
    expect(dataRow2).toEqual({ a: "v3", b: "v4" });
  });

  it("falls back to a single whole-table segment when nothing scores at the floor", () => {
    const rows = [row(0, [["nothing recognizable", 10]]), row(1, [["v1", 10]])];
    const segments = detectTableSegments(rows, classify);
    expect(segments).toHaveLength(1);
    expect(segments[0].columns).toEqual([]);
  });

  it("respects a custom minScore floor, falling back to the best available row when nothing clears it", () => {
    // Only one of two columns present — shouldn't count as a segment header
    // with minScore=2, so this falls back to detectColumns' best-row behavior.
    const rows = [row(0, [["ColA", 10]]), row(1, [["v1", 10]])];
    const segments = detectTableSegments(rows, classify, { minScore: 2 });
    expect(segments).toHaveLength(1);
    expect(segments[0].headerRowIndex).toBe(0);
    expect(segments[0].columns).toEqual([{ kind: "a", x: 10, header: "ColA", width: 20 }]);
  });
});

describe("alignRowToColumns onMatch callback", () => {
  const columns = [
    { kind: "a" as Kind, x: 10, header: "ColA" },
    { kind: "b" as Kind, x: 100, header: "ColB" },
  ];

  it("calls onMatch with the cell index and kind for every matched cell", () => {
    const calls: Array<[number, Kind]> = [];
    const aligned = alignRowToColumns(row(1, [["v1", 10], ["v2", 100]]), columns, undefined, (i, kind) =>
      calls.push([i, kind]),
    );

    expect(aligned).toEqual({ a: "v1", b: "v2" });
    expect(calls).toEqual([
      [0, "a"],
      [1, "b"],
    ]);
  });

  it("never calls onMatch for a cell outside maxDistance", () => {
    const calls: Array<[number, Kind]> = [];
    // Far outside the default 50pt cap for either column.
    alignRowToColumns(row(1, [["stray", 5000]]), columns, undefined, (i, kind) => calls.push([i, kind]));
    expect(calls).toEqual([]);
  });
});

describe("alignRowToColumns width-range fallback", () => {
  // Reduced repro of the real bank-statement bug: a header cell glues two
  // sub-labels together ("Value Dt Withdrawal Amt.") at x=361.5, width=104.3
  // — its OWN x is >50pt from where the real amount data renders (x=438),
  // so point-distance matching alone misses it entirely.
  const columns = [{ kind: "amount" as const, x: 361.5, header: "Value Dt Withdrawal Amt.", width: 104.3 }];

  it("matches a cell outside point-distance tolerance but inside the header's [x, x+width] span", () => {
    const aligned = alignRowToColumns(row(1, [["49,950.00", 438.235]]), columns);
    expect(aligned).toEqual({ amount: "49,950.00" });
  });

  it("still rejects a cell outside both point tolerance and the width span", () => {
    const aligned = alignRowToColumns(row(1, [["111222", 900]]), columns);
    expect(aligned).toEqual({});
  });

  it("matches the column whose own span contains the cell, even when another column's header point is technically also within its own narrow span", () => {
    const twoColumns = [
      { kind: "a" as const, x: 10, header: "ColA", width: 5 },
      { kind: "b" as const, x: 50, header: "ColB", width: 200 }, // wide enough to also spatially cover x=10
    ];
    const aligned = alignRowToColumns(row(1, [["v", 10]]), twoColumns);
    expect(aligned).toEqual({ a: "v" });
  });

  it("does not use the width fallback when a column has no width (e.g. hand-built columns)", () => {
    const noWidthColumns = [{ kind: "amount" as const, x: 361.5, header: "Value Dt Withdrawal Amt." }];
    const aligned = alignRowToColumns(row(1, [["49,950.00", 438.235]]), noWidthColumns);
    expect(aligned).toEqual({});
  });

  it("prefers its own column's width span over raw point-distance to a NEARER neighboring header (real-world regression)", () => {
    // The actual bug: HDFC's "Value Dt Withdrawal Amt." header glues two
    // sub-labels together at x=361.5 — far LEFT of where withdrawal amounts
    // actually right-align (~420-465). A withdrawal amount with few digits
    // (so it renders further right) can end up CLOSER by raw point-distance
    // to the NEXT column's header ("Deposit Amt." at x=491) than to its own
    // header, even though it's still spatially inside its own column's
    // printed span. Point-distance alone would misclassify every such
    // withdrawal as a deposit — this silently swapped roughly two-thirds of
    // the debits/credits in a real captured statement.
    const columns = [
      { kind: "debit" as const, x: 361.503, header: "Value Dt Withdrawal Amt.", width: 104.259 },
      { kind: "credit" as const, x: 491.054, header: "Deposit Amt.", width: 44.88 },
    ];
    // x=442.235: point-distance to "credit" header (48.8) is LESS than to
    // "debit" header (80.7) — nearest-by-point-distance alone would pick
    // "credit" — but 442.235 falls inside "debit"'s own [361.503, 465.762]
    // span and outside "credit"'s [491.054, 535.934] span entirely.
    const aligned = alignRowToColumns(row(1, [["1,500.00", 442.235]]), columns);
    expect(aligned).toEqual({ debit: "1,500.00" });
  });
});

describe("findBoilerplateRows", () => {
  it("flags a row whose text repeats verbatim at or above minRepeats times", () => {
    const rows = [
      row(0, [["EXAMPLE BANK LIMITED", 28]]),
      row(1, [["v1", 10]]),
      row(2, [["EXAMPLE BANK LIMITED", 28]]),
      row(3, [["v2", 10]]),
      row(4, [["EXAMPLE BANK LIMITED", 28]]),
    ];

    const boilerplate = findBoilerplateRows(rows, classify);

    expect(boilerplate).toEqual(new Set([0, 2, 4]));
  });

  it("does not flag text repeating fewer than minRepeats times", () => {
    const rows = [row(0, [["SOME FOOTER", 28]]), row(1, [["v1", 10]]), row(2, [["SOME FOOTER", 28]])];

    expect(findBoilerplateRows(rows, classify)).toEqual(new Set());
  });

  it("never flags a row that classifies as a table header, even if it recurs (a header restated on every page)", () => {
    const rows = [
      row(0, [["ColA", 10], ["ColB", 100]]),
      row(1, [["v1", 10], ["v2", 100]]),
      row(2, [["ColA", 10], ["ColB", 100]]), // page 2's restated header
      row(3, [["v3", 10], ["v4", 100]]),
      row(4, [["ColA", 10], ["ColB", 100]]), // page 3's restated header
      row(5, [["v5", 10], ["v6", 100]]),
    ];

    expect(findBoilerplateRows(rows, classify)).toEqual(new Set());
  });

  it("ignores blank rows", () => {
    const rows = [row(0, [["", 10]]), row(1, [["", 10]]), row(2, [["", 10]])];
    expect(findBoilerplateRows(rows, classify)).toEqual(new Set());
  });

  it("respects a custom minRepeats", () => {
    const rows = [row(0, [["FOOTER", 28]]), row(1, [["FOOTER", 28]])];
    expect(findBoilerplateRows(rows, classify, { minRepeats: 2 })).toEqual(new Set([0, 1]));
    expect(findBoilerplateRows(rows, classify, { minRepeats: 3 })).toEqual(new Set());
  });
});
