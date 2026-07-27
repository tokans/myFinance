/* Ad-hoc verification: run the new comprehensive Form16 parser against the
 * raw rows captured in a real debug dump, without needing the Tauri app.
 * Usage: npx tsx scripts/verify-form16-dump.ts <path-to-debug-dump.yaml> */
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { extractForm16Header } from "../src/tax/form16Header";
import { parseForm16PartB } from "../src/tax/form16PartB";
import { parseForm16TaxDeposits } from "../src/tax/form16TaxDeposits";
import { parseForm16QuarterTable } from "../src/tax/form16TdsTable";
import type { PdfTableRow } from "../src/statements/types";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx scripts/verify-form16-dump.ts <path-to-debug-dump.yaml>");
  process.exit(1);
}

const dump = parse(readFileSync(path, "utf-8")) as { rows: PdfTableRow[] };
const rows = dump.rows;
console.log(`total rows: ${rows.length}`);

const header = extractForm16Header(rows);
console.log("header:", header);

const { quarters, claimed: quarterClaimed } = parseForm16QuarterTable(rows);
console.log(`quarters found: ${quarters.length}`, quarters);

const { deposits, claimed: depositClaimed } = parseForm16TaxDeposits(rows);
console.log(`tax deposits found: ${deposits.length}`);
console.log(deposits.slice(0, 3), deposits.length > 3 ? `... +${deposits.length - 3} more` : "");

const { items: partB, claimed: partBClaimed } = parseForm16PartB(rows);
console.log(`Part B items found: ${partB.length}`);
for (const item of partB) console.log(`  ${item.marker}: ${item.label} => [${item.amounts.join(", ")}]`);

const claimed = new Set<number>([...quarterClaimed, ...depositClaimed, ...partBClaimed]);
const unclaimedCount = rows.filter((_, i) => !claimed.has(i)).length;
console.log(`\nclaimed: ${claimed.size} / ${rows.length} rows`);
console.log(`unclaimed (would show as raw table): ${unclaimedCount} rows`);
