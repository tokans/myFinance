import { describe, expect, it } from "vitest";
import { checkDocumentIdentity, normalizeAy } from "./documentIdentityCheck";

describe("normalizeAy", () => {
  it("passes through the app's own 2-digit-end convention unchanged", () => {
    expect(normalizeAy("2026-27")).toBe("2026-27");
  });

  it("collapses a 4-digit-end year (Form 16 header's own shape) to 2-digit", () => {
    expect(normalizeAy("2026-2027")).toBe("2026-27");
  });

  it("returns null for null input or an unparseable shape", () => {
    expect(normalizeAy(null)).toBeNull();
    expect(normalizeAy("not a year")).toBeNull();
  });
});

describe("checkDocumentIdentity", () => {
  const base = { detectedAy: null as string | null, detectedPan: null as string | null, currentAy: "2026-27", defaultAy: "2026-27", profilePan: "" };

  it("silently auto-fills the AY when the field is still at its untouched default", () => {
    const r = checkDocumentIdentity({ ...base, detectedAy: "2025-26" });
    expect(r.effectiveAy).toBe("2025-26");
    expect(r.ayAutoFilled).toBe(true);
    expect(r.ayMismatch).toBeNull();
  });

  it("warns instead of overwriting when the user already set a different AY than the document", () => {
    const r = checkDocumentIdentity({ ...base, currentAy: "2025-26", detectedAy: "2024-25" });
    expect(r.effectiveAy).toBe("2025-26");
    expect(r.ayAutoFilled).toBe(false);
    expect(r.ayMismatch).toEqual({ detected: "2024-25", current: "2025-26" });
  });

  it("doesn't false-flag a mismatch when the detected AY matches after format normalization", () => {
    // Form 16 header shape ("2026-2027") vs the app's own 2-digit convention.
    const r = checkDocumentIdentity({ ...base, currentAy: "2026-27", detectedAy: "2026-2027" });
    expect(r.ayMismatch).toBeNull();
    expect(r.ayAutoFilled).toBe(false);
  });

  it("does nothing AY-wise when the document has no detectable AY", () => {
    const r = checkDocumentIdentity({ ...base, currentAy: "2026-27" });
    expect(r.effectiveAy).toBe("2026-27");
    expect(r.ayAutoFilled).toBe(false);
    expect(r.ayMismatch).toBeNull();
  });

  it("flags a PAN mismatch against the saved tax filer profile", () => {
    const r = checkDocumentIdentity({ ...base, detectedPan: "AAAPA1111A", profilePan: "BBBPB2222B" });
    expect(r.panMismatch).toEqual({ detected: "AAAPA1111A", expected: "BBBPB2222B" });
  });

  it("doesn't flag a PAN mismatch that's only a casing difference", () => {
    const r = checkDocumentIdentity({ ...base, detectedPan: "aaapa1111a", profilePan: "AAAPA1111A" });
    expect(r.panMismatch).toBeNull();
  });

  it("doesn't flag a PAN mismatch when either side is unknown", () => {
    expect(checkDocumentIdentity({ ...base, detectedPan: null, profilePan: "AAAPA1111A" }).panMismatch).toBeNull();
    expect(checkDocumentIdentity({ ...base, detectedPan: "AAAPA1111A", profilePan: "" }).panMismatch).toBeNull();
  });
});
