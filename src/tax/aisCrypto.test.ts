import { describe, expect, it } from "vitest";
import { decryptAisFile, parseAisEnvelope } from "./aisCrypto";

/** Encrypt a JSON payload into the AIS wire format (hex IV + hex salt + b64 CT)
 *  using the same params decryptAisFile expects, so the round-trip proves both
 *  the envelope parsing and the crypto. */
async function makeEnvelope(obj: unknown, password: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pwKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 },
    pwKey,
    { name: "AES-CBC", length: 256 },
    false,
    ["encrypt"],
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, new TextEncoder().encode(JSON.stringify(obj))),
  );
  const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  let bin = "";
  for (const byte of ct) bin += String.fromCharCode(byte);
  return hex(iv) + hex(salt) + btoa(bin);
}

describe("aisCrypto", () => {
  it("splits the envelope into 16-byte IV + 16-byte salt + ciphertext", () => {
    const env = "0".repeat(32) + "1".repeat(32) + btoa("hello-cipher");
    const { iv, salt } = parseAisEnvelope(env);
    expect(iv.length).toBe(16);
    expect(salt.length).toBe(16);
  });

  it("round-trips: encrypt with a password, then decrypt recovers the JSON", async () => {
    const payload = { assessmentYear: "2025-26", pan: "ABCDE1234F", value: 12345 };
    const env = await makeEnvelope(payload, "secret-pw");
    const out = await decryptAisFile(env, { pan: "ZZZZZ0000Z", dob: "01011990", password: "secret-pw" });
    expect(out).toEqual(payload);
  });

  it("throws a friendly error when no password works", async () => {
    const env = await makeEnvelope({ a: 1 }, "right-pw");
    await expect(decryptAisFile(env, { pan: "ABCDE1234F", dob: "01011990" })).rejects.toThrow(/decrypt/i);
  });
});
