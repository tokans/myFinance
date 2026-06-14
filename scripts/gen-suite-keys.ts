/**
 * Offline key ceremony for the SUITE trust anchor (G4) — root + four delegated
 * roles (data / code / snapshot / timestamp) + the transport key. Run ONCE on a
 * trusted machine; for a real release this is an air-gapped / HSM ceremony with
 * the code role held as k-of-n across separate custodians. This script is the
 * single-machine, single-custody variant (dev / staging grade).
 *
 *   npx tsx scripts/gen-suite-keys.ts
 *
 * Produces, under `.keys/` (git-ignored — keep OUT of version control):
 *   - suite-root-ed25519.{private,public}.pem        (root; immutable, keep most-offline)
 *   - suite-data-ed25519.{private,public}.pem
 *   - suite-code-ed25519.{private,public}.pem        (high-value; real release: 2-of-n)
 *   - suite-snapshot-ed25519.{private,public}.pem
 *   - suite-timestamp-ed25519.{private,public}.pem
 *   - suite-transport.key                            (base64 AES-256; obfuscation-grade)
 *
 * It prints ONLY the public key bytes (hex) per role + the transport key (base64),
 * to bake into src/suite/config.ts and publisher.trust.json. Private keys are
 * written to disk but never printed. Back up the private + transport keys offline.
 */
import { generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEYS_DIR = join(process.cwd(), ".keys");
const ROLES = ["root", "data", "code", "snapshot", "timestamp"] as const;

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

// Pre-flight: refuse if ANY target exists, so we never half-rotate.
for (const role of ROLES) {
  refuseOverwrite(join(KEYS_DIR, `suite-${role}-ed25519.private.pem`));
  refuseOverwrite(join(KEYS_DIR, `suite-${role}-ed25519.public.pem`));
}
refuseOverwrite(join(KEYS_DIR, "suite-transport.key"));

const pubHex: Record<string, string> = {};
for (const role of ROLES) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(
    join(KEYS_DIR, `suite-${role}-ed25519.private.pem`),
    privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    { mode: 0o600 },
  );
  writeFileSync(
    join(KEYS_DIR, `suite-${role}-ed25519.public.pem`),
    publicKey.export({ type: "spki", format: "pem" }) as string,
  );
  pubHex[role] = rawPublicKey(publicKey).toString("hex");
}

const transport = randomBytes(32);
writeFileSync(join(KEYS_DIR, "suite-transport.key"), transport.toString("base64"), { mode: 0o600 });

console.log("Generated suite trust-anchor keys under .keys/ (private keys NOT printed).\n");
console.log("Bake these PUBLIC keys into src/suite/config.ts and publisher.trust.json:");
console.log(`  ROOT_PUBKEY_HEX      = "${pubHex.root}";`);
console.log(`  DATA_PUBKEY_HEX      = "${pubHex.data}";`);
console.log(`  CODE_PUBKEY_HEX      = "${pubHex.code}";`);
console.log(`  SNAPSHOT_PUBKEY_HEX  = "${pubHex.snapshot}";`);
console.log(`  TIMESTAMP_PUBKEY_HEX = "${pubHex.timestamp}";`);
console.log(`  SUITE_TRANSPORT_KEY_B64 = "${transport.toString("base64")}";\n`);
console.log("Keep .keys/ OUT of git. Back up the private + transport keys offline.");
