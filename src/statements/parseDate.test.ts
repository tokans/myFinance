import { describe, expect, it } from "vitest";
import { parseStatementDate, splitLeadingDate } from "./parseDate";

describe("parseStatementDate", () => {
  it("parses DD/MM/YYYY", () => {
    expect(parseStatementDate("01/04/2026")).toBe("2026-04-01");
  });

  it("parses DD-MM-YYYY", () => {
    expect(parseStatementDate("01-04-2026")).toBe("2026-04-01");
  });

  it("parses DD/MM/YY", () => {
    expect(parseStatementDate("01/04/26")).toBe("2026-04-01");
  });

  it("parses already-ISO dates", () => {
    expect(parseStatementDate("2026-04-01")).toBe("2026-04-01");
  });

  it("parses '01 Apr 2026'", () => {
    expect(parseStatementDate("01 Apr 2026")).toBe("2026-04-01");
  });

  it("parses '01-Apr-2026'", () => {
    expect(parseStatementDate("01-Apr-2026")).toBe("2026-04-01");
  });

  it("returns null for unrecognized text", () => {
    expect(parseStatementDate("Opening Balance")).toBeNull();
  });
});

describe("splitLeadingDate", () => {
  it("splits a DD/MM/YY date glued to trailing text with only a normal word-space gap", () => {
    expect(splitLeadingDate("01/04/26 SOME MERCHANT PAYMENT REF00001")).toEqual({
      date: "2026-04-01",
      rest: "SOME MERCHANT PAYMENT REF00001",
    });
  });

  it("splits a DD/MM/YYYY date the same way", () => {
    expect(splitLeadingDate("01/04/2026 SOME MERCHANT PAYMENT")).toEqual({
      date: "2026-04-01",
      rest: "SOME MERCHANT PAYMENT",
    });
  });

  it("splits a 'DD Mon YYYY' date", () => {
    expect(splitLeadingDate("01 Apr 2026 SOME MERCHANT PAYMENT")).toEqual({
      date: "2026-04-01",
      rest: "SOME MERCHANT PAYMENT",
    });
  });

  it("returns a null date and the original text unchanged when nothing looks like a date", () => {
    expect(splitLeadingDate("SOME MERCHANT PAYMENT REF00001")).toEqual({
      date: null,
      rest: "SOME MERCHANT PAYMENT REF00001",
    });
  });

  it("doesn't require trailing text — a bare date splits to an empty rest", () => {
    expect(splitLeadingDate("01/04/2026")).toEqual({ date: "2026-04-01", rest: "" });
  });
});
