import { describe, it, expect, beforeAll } from "vitest";
import { keygenAsync, signAsync, etc } from "@noble/ed25519";
import {
  verifyManifestSignature,
  verifyAndDecryptManifest,
  decryptTransport,
  sha256Hex,
  meetsMinVersion,
} from "./verify";

const enc = new TextEncoder();
const asSource = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

/** AES-256-GCM encrypt → iv(12) || ciphertext || tag(16), matching pack-masters.ts. */
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

interface Fixture {
  pubHex: string;
  transportB64: string;
  manifestBytes: Uint8Array;
  sig: Uint8Array;
  files: Record<string, Uint8Array>;
  payload: Array<{ value: string; label: string }>;
}

let fx: Fixture;

beforeAll(async () => {
  const { secretKey, publicKey } = await keygenAsync();
  const transportKey = crypto.getRandomValues(new Uint8Array(32));
  const payload = [
    { value: "IN", label: "India" },
    { value: "US", label: "United States" },
  ];
  const file = "country.master.enc";
  const encFile = await gcmEncrypt(enc.encode(JSON.stringify(payload)), transportKey);
  const manifest = {
    revision: 5,
    generatedAt: "2026-06-01T00:00:00.000Z",
    schemaVersion: 1,
    minAppVersion: "0.1.0",
    entries: [
      { id: "country", file, bytes: encFile.length, sha256: await sha256Hex(encFile), version: 5 },
    ],
  };
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  fx = {
    pubHex: etc.bytesToHex(publicKey),
    transportB64: b64(transportKey),
    manifestBytes,
    sig: await signAsync(manifestBytes, secretKey),
    files: { [file]: encFile },
    payload,
  };
});

describe("meetsMinVersion", () => {
  it("compares dotted versions, padding missing parts", () => {
    expect(meetsMinVersion("0.1.0", "0.1.0")).toBe(true);
    expect(meetsMinVersion("0.2.0", "0.1.0")).toBe(true);
    expect(meetsMinVersion("0.0.9", "0.1.0")).toBe(false);
    expect(meetsMinVersion("1.0", "0.9.9")).toBe(true);
  });
});

describe("signature + crypto primitives", () => {
  it("verifies a valid signature and rejects a wrong key", async () => {
    expect(await verifyManifestSignature(fx.manifestBytes, fx.sig, fx.pubHex)).toBe(true);
    const wrong = "1".repeat(64);
    expect(await verifyManifestSignature(fx.manifestBytes, fx.sig, wrong)).toBe(false);
  });

  it("rejects a tampered manifest", async () => {
    const bad = fx.manifestBytes.slice();
    bad[10] ^= 1;
    expect(await verifyManifestSignature(bad, fx.sig, fx.pubHex)).toBe(false);
  });

  it("decrypts a transport blob round-trip", async () => {
    const out = await decryptTransport(fx.files["country.master.enc"], fx.transportB64);
    expect(JSON.parse(new TextDecoder().decode(out))).toEqual(fx.payload);
  });
});

describe("verifyAndDecryptManifest", () => {
  const fetchFrom = (files: Record<string, Uint8Array>) => (f: string) => Promise.resolve(files[f]);

  it("verifies, decrypts, and returns the payload", async () => {
    const { manifest, entries } = await verifyAndDecryptManifest(fx.manifestBytes, fx.sig, {
      fetchFile: fetchFrom(fx.files),
      pubkeyHex: fx.pubHex,
      transportKeyB64: fx.transportB64,
      appVersion: "0.1.0",
    });
    expect(manifest.revision).toBe(5);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("country");
    expect(entries[0].payload).toEqual(fx.payload);
  });

  it("throws on an invalid signature", async () => {
    await expect(
      verifyAndDecryptManifest(fx.manifestBytes, fx.sig, {
        fetchFile: fetchFrom(fx.files),
        pubkeyHex: "1".repeat(64),
        transportKeyB64: fx.transportB64,
      }),
    ).rejects.toThrow(/signature invalid/);
  });

  it("rejects a stale (downgrade) revision", async () => {
    await expect(
      verifyAndDecryptManifest(fx.manifestBytes, fx.sig, {
        fetchFile: fetchFrom(fx.files),
        pubkeyHex: fx.pubHex,
        transportKeyB64: fx.transportB64,
        lastRevision: 5,
      }),
    ).rejects.toThrow(/stale manifest revision/);
  });

  it("rejects an app version below minAppVersion", async () => {
    await expect(
      verifyAndDecryptManifest(fx.manifestBytes, fx.sig, {
        fetchFile: fetchFrom(fx.files),
        pubkeyHex: fx.pubHex,
        transportKeyB64: fx.transportB64,
        appVersion: "0.0.9",
      }),
    ).rejects.toThrow(/below required/);
  });

  it("rejects a ciphertext whose sha256 doesn't match the manifest", async () => {
    const tampered = fx.files["country.master.enc"].slice();
    tampered[20] ^= 0xff;
    await expect(
      verifyAndDecryptManifest(fx.manifestBytes, fx.sig, {
        fetchFile: fetchFrom({ "country.master.enc": tampered }),
        pubkeyHex: fx.pubHex,
        transportKeyB64: fx.transportB64,
      }),
    ).rejects.toThrow(/sha256 mismatch|size mismatch/);
  });
});
