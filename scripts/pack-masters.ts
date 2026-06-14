/**
 * Offline packer: turn the baked master JSON in `src/masters/data/` into the
 * over-the-air bundle — one AES-256-GCM-encrypted file per master plus a manifest.
 * Run on the owner's machine (NOT in CI), then sign with `masters:sign`.
 *
 *   npm run masters:pack -- --revision 3 --min-app-version 0.1.0
 *
 * Flags:
 *   --revision N           monotonic manifest revision (required; clients reject <= last)
 *   --min-app-version X    semver gate; binaries older than this skip the bundle (default 0.1.0)
 *   --schema-version N     master-shape version (default 1)
 *
 * Transport key: read from $MASTERS_TRANSPORT_KEY (base64) or `.keys/transport.key`.
 * Output: `dist-masters/<id>.master.enc` + `dist-masters/masters.manifest.json`.
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  manifestSchema,
  masterPayloadSchema,
  partnerPayloadSchema,
  type MasterPayload,
} from "../src/masters/updateSchema";

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "src", "masters", "data");
const OUT_DIR = join(ROOT, "dist-masters");

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing required flag --${name}`);
  process.exit(1);
}

function loadTransportKey(): Buffer {
  const b64 = process.env.MASTERS_TRANSPORT_KEY ?? tryReadKeyFile();
  if (!b64) {
    console.error("No transport key. Set $MASTERS_TRANSPORT_KEY or run `npm run masters:keys`.");
    process.exit(1);
  }
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) {
    console.error(`Transport key must be 32 bytes (got ${key.length}).`);
    process.exit(1);
  }
  return key;
}

function tryReadKeyFile(): string | null {
  const p = join(ROOT, ".keys", "transport.key");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));

/** Flatten the per-country city seed map into parent-tagged option rows. */
function flattenCities(seed: Record<string, string[]>): MasterPayload {
  const out: MasterPayload = [];
  for (const [country, cities] of Object.entries(seed)) {
    for (const city of cities) out.push({ value: city, label: city, parent: country });
  }
  return out;
}

/** Source map: master id -> its plaintext option payload. life_goal is template-derived, not packed here. */
function buildPayloads(): Record<string, MasterPayload> {
  return {
    country: readJson("countries.json") as MasterPayload,
    currency: readJson("currencies.json") as MasterPayload,
    institution: readJson("institutions.json") as MasterPayload,
    relationship: readJson("relationships.json") as MasterPayload,
    professional_type: readJson("professional-types.json") as MasterPayload,
    city: flattenCities(readJson("cities.seed.json") as Record<string, string[]>),
  };
}

/** AES-256-GCM: output = iv(12) || ciphertext || tag(16). */
function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]);
}

const revision = Number(arg("revision"));
if (!Number.isInteger(revision) || revision < 0) {
  console.error("--revision must be a non-negative integer.");
  process.exit(1);
}
const minAppVersion = arg("min-app-version", "0.1.0");
const schemaVersion = Number(arg("schema-version", "1"));

const transportKey = loadTransportKey();
mkdirSync(OUT_DIR, { recursive: true });

const entries = [];
for (const [id, payload] of Object.entries(buildPayloads())) {
  // Validate before shipping so we never publish malformed data.
  const parsed = masterPayloadSchema.parse(payload);
  const plain = Buffer.from(JSON.stringify(parsed), "utf8");
  const enc = encrypt(plain, transportKey);
  const file = `${id}.master.enc`;
  writeFileSync(join(OUT_DIR, file), enc);
  entries.push({
    id,
    file,
    bytes: enc.length,
    sha256: createHash("sha256").update(enc).digest("hex"),
    version: revision,
  });
  console.log(`  packed ${id}: ${parsed.length} options -> ${file} (${enc.length} bytes)`);
}

// Optional partner directory (contact PII). Packed only if a curated source exists;
// partners ship empty by default and are published separately by the owner.
const partnersSource = join(DATA_DIR, "partners.json");
if (existsSync(partnersSource)) {
  const partners = partnerPayloadSchema.parse(JSON.parse(readFileSync(partnersSource, "utf8")));
  const enc = encrypt(Buffer.from(JSON.stringify(partners), "utf8"), transportKey);
  const file = "partner.master.enc";
  writeFileSync(join(OUT_DIR, file), enc);
  entries.push({
    id: "partner",
    file,
    bytes: enc.length,
    sha256: createHash("sha256").update(enc).digest("hex"),
    version: revision,
  });
  console.log(`  packed partner: ${partners.length} partners -> ${file} (${enc.length} bytes)`);
}

const manifest = manifestSchema.parse({
  revision,
  generatedAt: new Date().toISOString(),
  schemaVersion,
  minAppVersion,
  entries,
});
writeFileSync(join(OUT_DIR, "masters.manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`\nManifest revision ${revision} written to dist-masters/masters.manifest.json`);
console.log("Next: `npm run masters:sign` to produce masters.manifest.json.sig");
