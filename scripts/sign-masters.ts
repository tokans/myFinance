/**
 * Offline signer: produce the detached Ed25519 signature over the packed manifest.
 * Run on the owner's machine after `masters:pack`, with the private key present.
 *
 *   npm run masters:sign
 *
 * Reads `dist-masters/masters.manifest.json` and the private key from
 * $MASTERS_PRIVATE_KEY_PEM or `.keys/masters-ed25519.private.pem`. Writes
 * `dist-masters/masters.manifest.json.sig` (base64). The client verifies this
 * signature against the baked public key BEFORE trusting or decrypting anything.
 */
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "dist-masters");
const MANIFEST = join(OUT_DIR, "masters.manifest.json");
const SIG = join(OUT_DIR, "masters.manifest.json.sig");

function loadPrivateKey() {
  const pem = process.env.MASTERS_PRIVATE_KEY_PEM ?? tryReadKeyFile();
  if (!pem) {
    console.error("No private key. Set $MASTERS_PRIVATE_KEY_PEM or run `npm run masters:keys`.");
    process.exit(1);
  }
  return createPrivateKey(pem);
}

function tryReadKeyFile(): string | null {
  const p = join(ROOT, ".keys", "masters-ed25519.private.pem");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

if (!existsSync(MANIFEST)) {
  console.error("No manifest found. Run `npm run masters:pack` first.");
  process.exit(1);
}

const manifestBytes = readFileSync(MANIFEST);
const key = loadPrivateKey();
// Ed25519: algorithm arg must be null; sign over the exact manifest bytes.
const signature = sign(null, manifestBytes, key);
writeFileSync(SIG, signature.toString("base64"));

console.log(`Signed masters.manifest.json -> masters.manifest.json.sig (${signature.length} bytes)`);
console.log("Publish dist-masters/* with `publish-masters.bat <revision>`.");
