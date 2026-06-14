/**
 * Generate the offline keys for the master-update pipeline. Run ONCE on the
 * owner's machine; never in CI.
 *
 *   npx tsx scripts/gen-master-keys.ts
 *
 * Produces, under `.keys/` (git-ignored — keep these out of version control):
 *   - masters-ed25519.private.pem   Ed25519 private signing key (SECRET)
 *   - masters-ed25519.public.pem    Ed25519 public key
 *   - transport.key                 base64 AES-256 transport key (obfuscation-grade)
 *
 * It also prints the public-key bytes to bake into the Rust verifier
 * (`src-tauri/src/masters_update.rs`, Phase 6) and the transport key for the
 * packer. Store the private key + transport key in your password manager.
 *
 * NOTE: the *executable* self-update (Tauri Updater) uses its own separate key,
 * generated with `npm run tauri signer generate` — not this script.
 */
import { generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEYS_DIR = join(process.cwd(), ".keys");

function refuseOverwrite(path: string) {
  if (existsSync(path)) {
    console.error(`Refusing to overwrite existing key: ${path}`);
    console.error("Delete it deliberately first if you really mean to rotate.");
    process.exit(1);
  }
}

/** Raw 32-byte Ed25519 public key = last 32 bytes of the SPKI DER encoding. */
function rawPublicKey(pub: KeyObject): Buffer {
  const der = pub.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32));
}

mkdirSync(KEYS_DIR, { recursive: true });

const privPath = join(KEYS_DIR, "masters-ed25519.private.pem");
const pubPath = join(KEYS_DIR, "masters-ed25519.public.pem");
const transportPath = join(KEYS_DIR, "transport.key");
[privPath, pubPath, transportPath].forEach(refuseOverwrite);

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }) as string);

const transport = randomBytes(32);
writeFileSync(transportPath, transport.toString("base64"), { mode: 0o600 });

const rawPub = rawPublicKey(publicKey);

console.log("Generated offline master-update keys under .keys/\n");
console.log("Bake this Ed25519 public key into src-tauri/src/masters_update.rs (Phase 6):");
console.log(`  const MASTERS_PUBKEY: [u8; 32] = [${[...rawPub].join(", ")}];`);
console.log(`  (hex: ${rawPub.toString("hex")})\n`);
console.log("Transport key (base64) — used by the packer, store it secretly:");
console.log(`  ${transport.toString("base64")}\n`);
console.log("Keep .keys/ OUT of git. Back up the private + transport keys offline.");
