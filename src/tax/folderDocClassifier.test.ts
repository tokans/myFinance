import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@/db/settings", () => ({
  getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
}));

import {
  classifyFilenameSync,
  FOLDER_IMPORT_ALLOWED_EXTENSIONS,
  isSupportedFolderDocFile,
  learnDocKeyword,
  loadLearnedDocKeywordRules,
} from "./folderDocClassifier";

describe("classifyFilenameSync — builtin rules", () => {
  it.each([
    ["Form16_ACME_2026.pdf", "form16"],
    ["Form26AS_AY2026-27.pdf", "form26as"],
    ["AIS_2026.pdf", "ais_pdf"],
    ["TIS_2026.pdf", "tis_pdf"],
    ["Capital_Gains_Statement_Zerodha.pdf", "capital_gains"],
    ["ITR-V_Acknowledgement.pdf", "it_return"],
    ["CA_Computation_Sheet_2026.pdf", "ca_computation"],
    ["HDFC_Bank_Statement_Jan2026.pdf", "bank_statement"],
    ["Account_Statement_Apr2026_to_Jun2026.pdf", "bank_statement"],
    ["Passbook_2026.pdf", "bank_statement"],
  ] as const)("classifies %s as %s", (filename, expected) => {
    expect(classifyFilenameSync(filename, []).category).toBe(expected);
  });

  it("does not false-positive a short token inside an unrelated word", () => {
    expect(classifyFilenameSync("raise_funds_2026.pdf", []).category).toBeNull();
  });

  it("a bare .json extension is decisive for itr_json, even over an 'itr' collision with it_return", () => {
    const result = classifyFilenameSync("ITR2_AY2026-27_prefill.json", []);
    expect(result.category).toBe("itr_json");
    expect(result.ambiguous).toBe(false);
  });

  it("returns no match for an unrelated filename", () => {
    const result = classifyFilenameSync("random_notes.pdf", []);
    expect(result).toEqual({ category: null, matchedKeyword: null, ambiguous: false, candidates: [] });
  });

  it("flags ambiguity when a filename matches two distinct builtin types", () => {
    const result = classifyFilenameSync("Form16_and_26AS_combined.pdf", []);
    expect(result.category).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.candidates.sort()).toEqual(["form16", "form26as"]);
  });
});

describe("learnDocKeyword + loadLearnedDocKeywordRules", () => {
  beforeEach(() => store.clear());

  it("persists a learned keyword and applies it on the next classification", async () => {
    expect(classifyFilenameSync("acme_payslip_summary_2026.pdf", []).category).toBeNull();
    await learnDocKeyword("payslip summary", "form16");
    const learned = await loadLearnedDocKeywordRules();
    expect(learned).toEqual([{ keyword: "payslip summary", docType: "form16" }]);
    expect(classifyFilenameSync("acme_payslip_summary_2026.pdf", learned).category).toBe("form16");
  });

  it("overwrites (last-write-wins) a prior learned mapping for the same keyword", async () => {
    await learnDocKeyword("statement", "capital_gains");
    await learnDocKeyword("statement", "form26as");
    const learned = await loadLearnedDocKeywordRules();
    expect(learned).toEqual([{ keyword: "statement", docType: "form26as" }]);
  });

  it("a learned rule disagreeing with a builtin rule is surfaced as ambiguous, not silently resolved", async () => {
    await learnDocKeyword("form16", "ca_computation");
    const learned = await loadLearnedDocKeywordRules();
    const result = classifyFilenameSync("Form16_Employer.pdf", learned);
    expect(result.ambiguous).toBe(true);
    expect(result.candidates.sort()).toEqual(["ca_computation", "form16"]);
  });
});

describe("isSupportedFolderDocFile", () => {
  it("accepts every allowed extension", () => {
    for (const ext of FOLDER_IMPORT_ALLOWED_EXTENSIONS) {
      expect(isSupportedFolderDocFile(`file.${ext}`)).toBe(true);
    }
  });

  it("rejects unrelated file types (images, OS metadata files)", () => {
    expect(isSupportedFolderDocFile("photo.jpg")).toBe(false);
    expect(isSupportedFolderDocFile(".DS_Store")).toBe(false);
    expect(isSupportedFolderDocFile("Thumbs.db")).toBe(false);
  });
});
