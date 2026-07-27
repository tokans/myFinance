import { describe, expect, it } from "vitest";
import { matchCategory, normalizeText, suggestKeyword, upsertLearnedRule, type KeywordRule } from "./keywordCategoryMatcher";

type Kind = "a" | "b" | "c";

describe("normalizeText", () => {
  it("lowercases and collapses non-alphanumeric runs to a single space", () => {
    expect(normalizeText("Form16_PartA-2026.pdf")).toBe("form16 parta 2026 pdf");
    expect(normalizeText("  ais   2026  ")).toBe("ais 2026");
  });
});

describe("matchCategory", () => {
  it("matches a short keyword only as a whole token", () => {
    const rules: KeywordRule<Kind>[] = [{ keyword: "ais", category: "a" }];
    expect(matchCategory("AIS_2026.pdf", rules).category).toBe("a");
    expect(matchCategory("raise_funds.pdf", rules).category).toBeNull();
    expect(matchCategory("raise_funds.pdf", rules).ambiguous).toBe(false);
  });

  it("matches a longer keyword as a partial substring", () => {
    const rules: KeywordRule<Kind>[] = [{ keyword: "form16", category: "a" }];
    expect(matchCategory("Form16_PartA_2026.pdf", rules).category).toBe("a");
  });

  it("returns no match and no ambiguity when nothing hits", () => {
    const rules: KeywordRule<Kind>[] = [{ keyword: "form16", category: "a" }];
    const result = matchCategory("random_file.pdf", rules);
    expect(result).toEqual({ category: null, matchedKeyword: null, ambiguous: false, candidates: [] });
  });

  it("flags ambiguity when two distinct categories match, listing both candidates", () => {
    const rules: KeywordRule<Kind>[] = [
      { keyword: "form16", category: "a" },
      { keyword: "26as", category: "b" },
    ];
    const result = matchCategory("Form16_and_26AS_combined.pdf", rules);
    expect(result.category).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.candidates).toEqual(["a", "b"]);
  });

  it("is not ambiguous when multiple keywords corroborate the SAME category, and reports the longest match", () => {
    const rules: KeywordRule<Kind>[] = [
      { keyword: "ca", category: "c" },
      { keyword: "ca computation", category: "c" },
    ];
    const result = matchCategory("CA_Computation_Sheet_2026.pdf", rules);
    expect(result.category).toBe("c");
    expect(result.ambiguous).toBe(false);
    expect(result.matchedKeyword).toBe("ca computation");
  });
});

describe("suggestKeyword", () => {
  it("picks the longest non-numeric token of at least 3 characters", () => {
    expect(suggestKeyword("acme_salary_certificate_2026.pdf")).toBe("certificate");
  });

  it("returns empty when every token is too short or numeric", () => {
    expect(suggestKeyword("2026 01 26")).toBe("");
  });

  it("does not strip a file extension itself — callers with filenames strip it first", () => {
    expect(suggestKeyword("2026_01.pdf")).toBe("pdf");
  });
});

describe("upsertLearnedRule", () => {
  it("appends a new rule", () => {
    const rules = upsertLearnedRule<Kind>([], { keyword: "salary cert", category: "a" });
    expect(rules).toEqual([{ keyword: "salary cert", category: "a" }]);
  });

  it("replaces (last-write-wins) a prior rule for the same normalized keyword", () => {
    const first = upsertLearnedRule<Kind>([], { keyword: "salary cert", category: "a" });
    const second = upsertLearnedRule<Kind>(first, { keyword: "Salary Cert", category: "b" });
    expect(second).toEqual([{ keyword: "Salary Cert", category: "b" }]);
  });

  it("is a no-op for an empty keyword", () => {
    expect(upsertLearnedRule<Kind>([], { keyword: "   ", category: "a" })).toEqual([]);
  });
});
