/**
 * Ad-hoc harness: decrypt + parse a real AIS file with the shipping modules.
 * Run: npx tsx scripts/test-ais.ts <path> <PAN> <DOB>
 */
import { readFileSync } from "node:fs";
import { decryptAisFile, parseAisEnvelope } from "../src/tax/aisCrypto";
import { parseAisJson } from "../src/tax/aisParser";

const [, , path, pan, dob] = process.argv;

async function main() {
  const text = readFileSync(path, "utf8");
  const { iv, salt, ct } = parseAisEnvelope(text);
  console.log(`envelope: iv=${iv.length}B salt=${salt.length}B ct=${ct.length}B (mult16=${ct.length % 16 === 0})`);

  const json = await decryptAisFile(text, { pan, dob });
  console.log("DECRYPTED OK. top-level keys:", Object.keys(json as Record<string, unknown>));
  console.log(JSON.stringify(json, null, 2).slice(0, 1500));

  console.log("\n=== parseAisJson ===");
  const r = parseAisJson(json);
  console.log("ay:", r.ay, "pan:", r.pan, "records:", r.recordCount, "unmapped:", r.unmappedCount);
  console.log("income:", r.income);
  console.log("payments:", r.payments);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
