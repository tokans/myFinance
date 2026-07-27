import { describe, expect, it } from "vitest";
import { pdfPasswordCandidates } from "./passwordCandidates";

describe("pdfPasswordCandidates", () => {
  it("tries an explicit override password first", () => {
    const list = pdfPasswordCandidates({ password: "myOwnPassword" });
    expect(list[0]).toBe("myOwnPassword");
  });

  it("generates PAN+DOB candidates in both cases", () => {
    const list = pdfPasswordCandidates({ pan: "ABCDE1234F", dob: "1990-05-15" });
    expect(list).toContain("abcde1234f15051990");
    expect(list).toContain("ABCDE1234F15051990");
  });

  it("generates PAN alone (both cases) — some portals use just the PAN as the password", () => {
    const list = pdfPasswordCandidates({ pan: "abcde1234f" });
    expect(list).toContain("ABCDE1234F");
    expect(list).toContain("abcde1234f");
  });

  it("generates DDMMYY and YYYYMMDD DOB forms alongside DDMMYYYY", () => {
    const list = pdfPasswordCandidates({ pan: "ABCDE1234F", dob: "1990-05-15" });
    expect(list).toContain("abcde1234f150590"); // DDMMYY form
    expect(list).toContain("abcde1234f19900515"); // YYYYMMDD form
  });

  it("generates a DDMmm-style DOB form (day + month name)", () => {
    const list = pdfPasswordCandidates({ dob: "15/05/1990" });
    expect(list).toContain("15may");
    expect(list).toContain("15MAY");
  });

  it("generates a DOB-only candidate", () => {
    const list = pdfPasswordCandidates({ dob: "15/05/1990" });
    expect(list).toContain("15051990");
  });

  it("generates name-based candidates from the first 4 letters", () => {
    const list = pdfPasswordCandidates({ name: "Sample Person", dob: "1990-05-15" });
    expect(list).toContain("SAMP15051990");
    expect(list).toContain("samp15051990");
    expect(list).toContain("15051990SAMP");
  });

  it("generates account-number + DOB candidates", () => {
    const list = pdfPasswordCandidates({ accountNumber: "1234567890", dob: "1990-05-15" });
    expect(list).toContain("789015051990");
    expect(list).toContain("150519907890");
  });

  it("combines name and account number when both are present", () => {
    const list = pdfPasswordCandidates({ name: "Sample Person", accountNumber: "1234567890" });
    expect(list).toContain("SAMP7890");
  });

  it("returns no candidates when given nothing", () => {
    expect(pdfPasswordCandidates({})).toEqual([]);
  });

  it("ignores a name shorter than 4 letters", () => {
    const list = pdfPasswordCandidates({ name: "Al", dob: "1990-05-15" });
    expect(list.some((c) => c.toLowerCase().startsWith("al"))).toBe(false);
  });

  it("de-duplicates candidates", () => {
    const list = pdfPasswordCandidates({ dob: "15051990" });
    expect(list.length).toBe(new Set(list).size);
  });
});
