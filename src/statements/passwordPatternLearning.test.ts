import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@/db/settings", () => ({
  getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
}));

import { resolveAtoms } from "./passwordCandidates";
import {
  candidatesFromLearnedShapes,
  describeShape,
  getLearnedShapes,
  inferShape,
  learnPatternIfNew,
} from "./passwordPatternLearning";

describe("inferShape", () => {
  it("recognizes a single-atom match", () => {
    const atoms = resolveAtoms({ pan: "ABCDE1234F" });
    expect(inferShape("abcde1234f", atoms)).toEqual(["PAN_LOWER"]);
  });

  it("recognizes a two-atom concatenation in order", () => {
    const atoms = resolveAtoms({ name: "Sample Person", accountNumber: "1234567890" });
    expect(inferShape("SAMP7890", atoms)).toEqual(["NAME4_UPPER", "ACCOUNT_LAST4"]);
  });

  it("returns null when the password matches no combination of the inputs", () => {
    const atoms = resolveAtoms({ pan: "ABCDE1234F", dob: "1990-05-15" });
    expect(inferShape("totally-unrelated-password", atoms)).toBeNull();
  });
});

describe("learnPatternIfNew + candidatesFromLearnedShapes", () => {
  beforeEach(() => store.clear());

  it("learns a genuinely new shape and later generates candidates from it for different inputs", async () => {
    // AccountLast4+Name4(upper) — the reverse order of the built-in
    // Name4(upper)+AccountLast4 pattern, so genuinely not already known.
    const learned = await learnPatternIfNew("7890SAMP", { name: "Sample Person", accountNumber: "1234567890" });
    expect(learned).toEqual(["ACCOUNT_LAST4", "NAME4_UPPER"]);
    expect(describeShape(learned!)).toContain("account number, last 4 digits");

    // A different person's name/account should now also get this shape tried.
    const candidates = await candidatesFromLearnedShapes({ name: "Priya Sharma", accountNumber: "9988776655" });
    expect(candidates).toContain("6655PRIY");
  });

  it("does not re-learn an already-known built-in shape", async () => {
    // PAN(lower)+DOB is already a built-in pattern.
    const learned = await learnPatternIfNew("abcde1234f15051990", { pan: "ABCDE1234F", dob: "1990-05-15" });
    expect(learned).toBeNull();
    expect(await getLearnedShapes()).toEqual([]);
  });

  it("does not learn the same new shape twice", async () => {
    await learnPatternIfNew("7890SAMP", { name: "Sample Person", accountNumber: "1234567890" });
    const secondTime = await learnPatternIfNew("6655PRIY", { name: "Priya Sharma", accountNumber: "9988776655" });
    expect(secondTime).toBeNull(); // same shape (ACCOUNT_LAST4+NAME4_UPPER), already learned
    expect(await getLearnedShapes()).toHaveLength(1);
  });

  it("returns null and learns nothing when the password doesn't match any input combination", async () => {
    const learned = await learnPatternIfNew("something-else-entirely", { pan: "ABCDE1234F" });
    expect(learned).toBeNull();
    expect(await getLearnedShapes()).toEqual([]);
  });
});
