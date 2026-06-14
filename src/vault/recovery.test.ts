import { describe, it, expect } from "vitest";
import type { RecoveryBlobStore, EscrowClient, WrappedKey } from "sharedcorelib/recovery";
import { buildRecovery } from "./recovery";

/** In-memory blob store (stands in for the on-disk free local store). */
function memBlobStore(): RecoveryBlobStore {
  let blob: WrappedKey | null = null;
  return {
    save: async (b) => { blob = b; },
    load: async () => blob,
    clear: async () => { blob = null; },
  };
}

const MK = new Uint8Array(32).map((_, i) => (i * 7 + 1) & 0xff);

describe("Phase 5 — recovery (free local floor, login-less)", () => {
  it("enrolls + recovers the master key with the RK alone, no backend", async () => {
    const r = buildRecovery({ blobStore: memBlobStore() }); // no escrow → no backend
    const { recoveryKey } = await r.enroll(MK);
    expect(recoveryKey.length).toBeGreaterThan(0);

    const recovered = await r.recover(recoveryKey);
    expect(Array.from(recovered)).toEqual(Array.from(MK));
  });

  it("a wrong RK cannot recover the master key", async () => {
    const r = buildRecovery({ blobStore: memBlobStore() });
    await r.enroll(MK);
    await expect(r.recover("WRONG-KEY-AAAA-BBBB-CCCC")).rejects.toThrow();
  });

  it("rekey rotates the RK (old RK no longer opens the blob)", async () => {
    const store = memBlobStore();
    const r = buildRecovery({ blobStore: store });
    const { recoveryKey: oldRk } = await r.enroll(MK);
    const { recoveryKey: newRk } = await r.rekey(MK);
    expect(newRk).not.toBe(oldRk);
    await expect(r.recover(oldRk)).rejects.toThrow();
    expect(Array.from(await r.recover(newRk))).toEqual(Array.from(MK));
  });

  it("registered-tier escrow moves only CIPHERTEXT (zero-knowledge)", async () => {
    let pushed: WrappedKey | null = null;
    const escrow: EscrowClient = {
      push: async (b) => { pushed = b; },
      pull: async () => pushed,
    };
    const r = buildRecovery({ blobStore: memBlobStore(), escrow });
    const { recoveryKey } = await r.enroll(MK);
    expect(pushed).not.toBeNull();
    // the escrowed blob is opaque ciphertext — the plaintext MK is not present
    const text = new TextDecoder().decode(pushed!);
    expect(text).not.toContain(String.fromCharCode(...MK.slice(0, 4)));
    // and the RK (the unlocking secret) is NOT in the blob
    expect(text).not.toContain(recoveryKey);
  });
});
