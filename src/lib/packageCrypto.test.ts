import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "./packageCrypto";

describe("packageCrypto", () => {
  it("round-trips a JSON value", async () => {
    const value = { accounts: [{ name: "HDFC", value: 1000 }], note: "हिन्दी ok" };
    const sealed = await encryptJson(value, "correct horse battery staple");
    expect(sealed.length).toBeGreaterThan(28);
    const back = await decryptJson(sealed, "correct horse battery staple");
    expect(back).toEqual(value);
  });

  it("fails to decrypt with the wrong passphrase", async () => {
    const sealed = await encryptJson({ x: 1 }, "right");
    await expect(decryptJson(sealed, "wrong")).rejects.toBeDefined();
  });

  it("rejects a too-short package", async () => {
    await expect(decryptJson(new Uint8Array([1, 2, 3]), "x")).rejects.toThrow();
  });

  it("produces different ciphertext each time (random salt/iv)", async () => {
    const a = await encryptJson({ x: 1 }, "p");
    const b = await encryptJson({ x: 1 }, "p");
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
