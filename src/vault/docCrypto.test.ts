import { describe, expect, it } from "vitest";
import { openWithKey, sealWithKey } from "./docCrypto";

const key = new Uint8Array(32).map((_, i) => (i * 7) % 256);

describe("docCrypto round-trip", () => {
  it("seals and opens back to the original bytes", async () => {
    const plain = new TextEncoder().encode("Will of Anshuman — original in bank locker");
    const sealed = await sealWithKey(key, plain);
    // Sealed form is iv(12) || ciphertext, and not equal to plaintext.
    expect(sealed.length).toBeGreaterThan(plain.length + 12);
    const opened = await openWithKey(key, sealed);
    expect(new TextDecoder().decode(opened)).toBe("Will of Anshuman — original in bank locker");
  });

  it("uses a random IV so two seals of the same input differ", async () => {
    const plain = new Uint8Array([1, 2, 3, 4]);
    const a = await sealWithKey(key, plain);
    const b = await sealWithKey(key, plain);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("fails to open with the wrong key", async () => {
    const sealed = await sealWithKey(key, new Uint8Array([9, 9, 9]));
    const wrong = new Uint8Array(32).fill(1);
    await expect(openWithKey(wrong, sealed)).rejects.toBeDefined();
  });

  it("rejects a too-short blob", async () => {
    await expect(openWithKey(key, new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
