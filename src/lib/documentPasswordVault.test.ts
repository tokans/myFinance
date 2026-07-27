import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, { label: string; username: string; password: string }>();

vi.mock("@/vault/stronghold", () => ({
  getCredential: vi.fn(async (key: string) => store.get(key) ?? null),
  putCredential: vi.fn(async (key: string, cred: { label: string; username: string; password: string }) => {
    store.set(key, cred);
  }),
  removeCredential: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

const settingsStore = new Map<string, string>();
vi.mock("@/db/settings", () => ({
  getSetting: vi.fn(async (key: string) => settingsStore.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    settingsStore.set(key, value);
  }),
}));

const ensureVaultUnlocked = vi.fn(async () => true);
vi.mock("@/stores/vaultPrompt.store", () => ({
  ensureVaultUnlocked: () => ensureVaultUnlocked(),
}));

import {
  candidatesWithStoredPassword,
  forgetDocumentPassword,
  getStoredDocumentPassword,
  rememberDocumentPassword,
} from "./documentPasswordVault";

describe("documentPasswordVault", () => {
  beforeEach(() => {
    store.clear();
    settingsStore.clear();
    ensureVaultUnlocked.mockClear();
    ensureVaultUnlocked.mockImplementation(async () => true);
  });

  it("returns null when nothing is stored", async () => {
    expect(await getStoredDocumentPassword("bank_statement", "HDFC Savings")).toBeNull();
  });

  it("remembers and retrieves a password, normalizing the identifier", async () => {
    await rememberDocumentPassword("bank_statement", "  HDFC Savings  ", "secret123", "HDFC Savings");
    expect(await getStoredDocumentPassword("bank_statement", "hdfc savings")).toBe("secret123");
  });

  it("keeps different document kinds and identifiers separate", async () => {
    await rememberDocumentPassword("bank_statement", "HDFC Savings", "bankpw", "HDFC Savings");
    await rememberDocumentPassword("form16", "ACME Corp", "form16pw", "ACME Corp");
    await rememberDocumentPassword("bank_statement", "ICICI Current", "icicipw", "ICICI Current");

    expect(await getStoredDocumentPassword("bank_statement", "HDFC Savings")).toBe("bankpw");
    expect(await getStoredDocumentPassword("form16", "ACME Corp")).toBe("form16pw");
    expect(await getStoredDocumentPassword("bank_statement", "ICICI Current")).toBe("icicipw");
  });

  it("forgets a stored password", async () => {
    await rememberDocumentPassword("ais", "ABCDE1234F", "aispw", "PAN ABCDE1234F");
    await forgetDocumentPassword("ais", "ABCDE1234F");
    expect(await getStoredDocumentPassword("ais", "ABCDE1234F")).toBeNull();
  });

  it("does nothing when the identifier or password is blank", async () => {
    await rememberDocumentPassword("bank_statement", "", "pw", "label");
    await rememberDocumentPassword("bank_statement", "Some Account", "", "label");
    expect(await getStoredDocumentPassword("bank_statement", "Some Account")).toBeNull();
  });

  describe("candidatesWithStoredPassword", () => {
    it("puts the stored password first, ahead of guessed candidates", async () => {
      await rememberDocumentPassword("form26as", "ABCDE1234F", "storedpw", "PAN ABCDE1234F");
      const candidates = await candidatesWithStoredPassword("form26as", "ABCDE1234F", {
        pan: "ABCDE1234F",
        dob: "1990-05-15",
      });
      expect(candidates[0]).toBe("storedpw");
      expect(candidates.length).toBeGreaterThan(1);
    });

    it("falls back to guessed candidates only when nothing is stored", async () => {
      const candidates = await candidatesWithStoredPassword("form26as", "ABCDE1234F", {
        pan: "ABCDE1234F",
        dob: "1990-05-15",
      });
      expect(candidates).toContain("abcde1234f15051990");
      expect(candidates[0]).not.toBe("storedpw");
    });

    it("de-duplicates when the stored password matches a guessed one", async () => {
      await rememberDocumentPassword("form26as", "ABCDE1234F", "abcde1234f15051990", "PAN ABCDE1234F");
      const candidates = await candidatesWithStoredPassword("form26as", "ABCDE1234F", {
        pan: "ABCDE1234F",
        dob: "1990-05-15",
      });
      expect(candidates.filter((c) => c === "abcde1234f15051990")).toHaveLength(1);
    });

    it("falls back to guessed candidates without throwing when the vault stays locked", async () => {
      await rememberDocumentPassword("form26as", "ABCDE1234F", "storedpw", "PAN ABCDE1234F");
      ensureVaultUnlocked.mockImplementation(async () => false);
      const candidates = await candidatesWithStoredPassword("form26as", "ABCDE1234F", {
        pan: "ABCDE1234F",
        dob: "1990-05-15",
      });
      expect(candidates).not.toContain("storedpw");
      expect(candidates).toContain("abcde1234f15051990");
    });
  });
});
