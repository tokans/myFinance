import { describe, it, expect, beforeAll } from "vitest";
import { keygenAsync, signAsync, etc } from "@noble/ed25519";
import { verifyAndDecryptGrant } from "./patronFile";

const enc = new TextEncoder();
const asSource = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

/** AES-256-GCM encrypt → iv(12) || ciphertext || tag(16), matching the publisher. */
async function gcmEncrypt(plain: Uint8Array, keyBytes: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", asSource(keyBytes), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: asSource(iv) }, key, asSource(plain)),
  );
  const out = new Uint8Array(12 + ctTag.length);
  out.set(iv, 0);
  out.set(ctTag, 12);
  return out;
}

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Build a signed+encrypted donation file's raw bytes for the given payload. */
async function buildFile(
  payload: unknown,
  secretKey: Uint8Array,
  transportKey: Uint8Array,
): Promise<Uint8Array> {
  const encBytes = await gcmEncrypt(enc.encode(JSON.stringify(payload)), transportKey);
  const sig = await signAsync(encBytes, secretKey);
  const envelope = { v: 1, enc: b64(encBytes), sig: b64(sig) };
  return enc.encode(JSON.stringify(envelope));
}

interface Fixture {
  pubHex: string;
  wrongPubHex: string;
  transportB64: string;
  secretKey: Uint8Array;
  transportKey: Uint8Array;
}
let fx: Fixture;

beforeAll(async () => {
  const { secretKey, publicKey } = await keygenAsync();
  const wrong = await keygenAsync();
  const transportKey = crypto.getRandomValues(new Uint8Array(32));
  fx = {
    pubHex: etc.bytesToHex(publicKey),
    wrongPubHex: etc.bytesToHex(wrong.publicKey),
    transportB64: b64(transportKey),
    secretKey,
    transportKey,
  };
});

describe("verifyAndDecryptGrant", () => {
  const opts = () => ({ pubkeyHex: fx.pubHex, transportKeyB64: fx.transportB64 });
  const patron = { kind: "patron", since: "2026-06-01" };

  it("verifies, decrypts, and returns the grant payload", async () => {
    const file = await buildFile(patron, fx.secretKey, fx.transportKey);
    const payload = await verifyAndDecryptGrant(file, opts());
    expect(payload).toMatchObject({ kind: "patron", since: "2026-06-01" });
  });

  it("verifies a partner grant", async () => {
    const file = await buildFile({ kind: "partner", since: "2026-06-01" }, fx.secretKey, fx.transportKey);
    const payload = await verifyAndDecryptGrant(file, opts());
    expect(payload.kind).toBe("partner");
  });

  it("rejects a file signed by a different key", async () => {
    const file = await buildFile(patron, fx.secretKey, fx.transportKey);
    await expect(
      verifyAndDecryptGrant(file, { pubkeyHex: fx.wrongPubHex, transportKeyB64: fx.transportB64 }),
    ).rejects.toThrow(/signature invalid/);
  });

  it("rejects a tampered ciphertext (signature no longer matches)", async () => {
    const file = await buildFile(patron, fx.secretKey, fx.transportKey);
    const obj = JSON.parse(new TextDecoder().decode(file));
    const ct = atob(obj.enc).split("");
    ct[20] = String.fromCharCode(ct[20].charCodeAt(0) ^ 0xff);
    obj.enc = btoa(ct.join(""));
    const tampered = enc.encode(JSON.stringify(obj));
    await expect(verifyAndDecryptGrant(tampered, opts())).rejects.toThrow(/signature invalid/);
  });

  it("rejects a payload missing a valid since date", async () => {
    const file = await buildFile({ kind: "patron", since: "01-06-2026" }, fx.secretKey, fx.transportKey);
    await expect(verifyAndDecryptGrant(file, opts())).rejects.toThrow();
  });

  it("rejects a payload with an unknown kind", async () => {
    const file = await buildFile({ kind: "vip", since: "2026-06-01" }, fx.secretKey, fx.transportKey);
    await expect(verifyAndDecryptGrant(file, opts())).rejects.toThrow();
  });

  it("rejects a malformed (non-envelope) file", async () => {
    await expect(
      verifyAndDecryptGrant(enc.encode("not json"), opts()),
    ).rejects.toThrow();
  });

  it("fails closed under the baked placeholder keys", async () => {
    // Default keys are all-zero placeholders → any real file is rejected.
    const file = await buildFile(patron, fx.secretKey, fx.transportKey);
    await expect(verifyAndDecryptGrant(file)).rejects.toThrow(/signature invalid/);
  });
});
