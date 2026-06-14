/**
 * Build a signed + encrypted grant file — the artifact handed to a donor (Patron)
 * or enrolled professional (Partner), which the app loads from their Downloads
 * folder to unlock the matching tier (see src/lib/patronFile.ts). Used to generate
 * fixtures for testing now, and intended for the tokans.org flows later (run
 * server-side per grant).
 *
 *   # one-time: generate the grant signing keypair + transport key
 *   npx tsx scripts/make-patron-file.ts --keygen
 *
 *   # make a Patron grant for a donation made on a given date
 *   npx tsx scripts/make-patron-file.ts --date 2026-06-01
 *   npx tsx scripts/make-patron-file.ts --date 2026-06-01 --downloads   # drop into ~/Downloads
 *   npx tsx scripts/make-patron-file.ts --date 2026-06-01 --out ./tmp/p.tokans --note "Thank you!"
 *
 *   # make a Partner grant (writes myfinance-partner.tokans)
 *   npx tsx scripts/make-patron-file.ts --kind partner --date 2026-06-01 --downloads
 *
 * Keys (SEPARATE from the masters keys — grant files are generated automatically,
 * so this signing key lives online, never the offline masters key):
 *   private  $PATRON_PRIVATE_KEY_PEM  or  .keys/patron-ed25519.private.pem
 *   transport $PATRON_TRANSPORT_KEY   or  .keys/patron-transport.key   (base64, 32 bytes)
 *
 * File format (matches src/lib/patronFile.ts):
 *   envelope JSON { v:1, enc, sig }
 *     enc = base64( iv(12) || AES-256-GCM ciphertext || tag(16) )  over JSON { kind, since, issuedAt?, note? }
 *     sig = base64( Ed25519 detached signature over the decoded `enc` bytes )
 */
import {
  createCipheriv,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const KEYS_DIR = join(ROOT, ".keys");
const OUT_DIR = join(ROOT, "dist-patron");
// Filenames per grant kind — keep in sync with PATRON_FILE_NAME / PARTNER_FILE_NAME.
const FILE_NAMES = { patron: "myfinance-patron.tokans", partner: "myfinance-partner.tokans" } as const;

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  if (fallback !== undefined) return fallback;
  console.error(`Missing required flag --${name}`);
  process.exit(1);
}

/** Raw 32-byte Ed25519 public key = last 32 bytes of the SPKI DER encoding. */
function rawPublicKey(pub: KeyObject): Buffer {
  const der = pub.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32));
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── keygen mode ──────────────────────────────────────────────────────────────
if (hasFlag("keygen")) {
  mkdirSync(KEYS_DIR, { recursive: true });
  const privPath = join(KEYS_DIR, "patron-ed25519.private.pem");
  const pubPath = join(KEYS_DIR, "patron-ed25519.public.pem");
  const transportPath = join(KEYS_DIR, "patron-transport.key");
  for (const p of [privPath, pubPath, transportPath]) {
    if (existsSync(p)) {
      console.error(`Refusing to overwrite existing key: ${p}`);
      console.error("Delete it deliberately first if you really mean to rotate.");
      process.exit(1);
    }
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
  writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }) as string);
  const transport = randomBytes(32);
  writeFileSync(transportPath, transport.toString("base64"), { mode: 0o600 });

  const rawPub = rawPublicKey(publicKey);
  console.log("Generated Patron keys under .keys/ (keep OUT of git; back up offline).\n");
  console.log("Bake these into src/lib/patronFile.ts:");
  console.log(`  export const PATRON_PUBKEY_HEX = "${rawPub.toString("hex")}";`);
  console.log(`  export const PATRON_TRANSPORT_KEY_B64 = "${transport.toString("base64")}";`);
  process.exit(0);
}

// ── file-creation mode ───────────────────────────────────────────────────────
function loadPrivateKey(): KeyObject {
  const pem =
    process.env.PATRON_PRIVATE_KEY_PEM ??
    (existsSync(join(KEYS_DIR, "patron-ed25519.private.pem"))
      ? readFileSync(join(KEYS_DIR, "patron-ed25519.private.pem"), "utf8")
      : null);
  if (!pem) {
    console.error("No private key. Set $PATRON_PRIVATE_KEY_PEM or run with --keygen first.");
    process.exit(1);
  }
  return createPrivateKey(pem);
}

function loadTransportKey(): Buffer {
  const b64 =
    process.env.PATRON_TRANSPORT_KEY ??
    (existsSync(join(KEYS_DIR, "patron-transport.key"))
      ? readFileSync(join(KEYS_DIR, "patron-transport.key"), "utf8")
      : null);
  if (!b64) {
    console.error("No transport key. Set $PATRON_TRANSPORT_KEY or run with --keygen first.");
    process.exit(1);
  }
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) {
    console.error(`Transport key must be 32 bytes (got ${key.length}).`);
    process.exit(1);
  }
  return key;
}

const kind = arg("kind", "patron");
if (kind !== "patron" && kind !== "partner") {
  console.error(`--kind must be "patron" or "partner" (got "${kind}").`);
  process.exit(1);
}
const FILE_NAME = FILE_NAMES[kind];

const since = arg("date", todayLocal());
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error(`--date must be YYYY-MM-DD (got "${since}").`);
  process.exit(1);
}
const note = hasFlag("note") ? arg("note") : undefined;

const payload = { kind, since, issuedAt: new Date().toISOString(), ...(note ? { note } : {}) };

// AES-256-GCM: enc = iv(12) || ciphertext || tag(16).
const transportKey = loadTransportKey();
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", transportKey, iv);
const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
const enc = Buffer.concat([iv, ct, cipher.getAuthTag()]);

// Ed25519 detached signature over the ciphertext bytes (verify-before-decrypt).
const sig = sign(null, enc, loadPrivateKey());

const envelope = { v: 1, enc: enc.toString("base64"), sig: sig.toString("base64") };
const envelopeBytes = Buffer.from(JSON.stringify(envelope), "utf8");

let outPath: string;
if (hasFlag("out")) {
  outPath = arg("out");
  mkdirSync(join(outPath, ".."), { recursive: true });
} else if (hasFlag("downloads")) {
  outPath = join(homedir(), "Downloads", FILE_NAME);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  outPath = join(OUT_DIR, FILE_NAME);
}
writeFileSync(outPath, envelopeBytes);

console.log(`Wrote ${kind} grant (since ${since}) -> ${outPath} (${envelopeBytes.length} bytes)`);
if (!hasFlag("downloads")) {
  console.log(`Hand this to the ${kind}; they save it into their Downloads folder as`);
  console.log(`  ${FILE_NAME}`);
}
