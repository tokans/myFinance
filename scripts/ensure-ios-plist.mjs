// Ensure the iOS Info.plist carries the keys device sync needs:
//   * NSLocalNetworkUsageDescription — iOS prompts the user before an app may
//     talk to other devices on the LAN (our Wi-Fi sync).
//   * NSBonjourServices             — the mDNS service types the app may browse.
//
// The Apple project only exists after `tauri ios init` (macOS), so this is a
// no-op-with-notice elsewhere. Idempotent: it inserts a key only when absent.
// Run: node scripts/ensure-ios-plist.mjs   (also `npm run ios:plist`).
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLE_DIR = join(ROOT, "src-tauri", "gen", "apple");

const USAGE_KEY = "NSLocalNetworkUsageDescription";
const BONJOUR_KEY = "NSBonjourServices";
const USAGE_BLOCK = `\t<key>${USAGE_KEY}</key>
\t<string>myFinance uses the local network to sync your data directly with your other devices over Wi-Fi. Nothing is sent to any server.</string>`;
const BONJOUR_BLOCK = `\t<key>${BONJOUR_KEY}</key>
\t<array>
\t\t<string>_myfinance._tcp</string>
\t</array>`;

if (!existsSync(APPLE_DIR)) {
  console.log("[ensure-ios-plist] No src-tauri/gen/apple yet — run `tauri ios init` on a Mac first. Skipping.");
  process.exit(0);
}

const plists = readdirSync(APPLE_DIR, { recursive: true })
  .map(String)
  .filter((p) => p.endsWith("Info.plist"))
  .map((p) => join(APPLE_DIR, p));

if (plists.length === 0) {
  console.log("[ensure-ios-plist] No Info.plist found under src-tauri/gen/apple. Skipping.");
  process.exit(0);
}

let touched = 0;
for (const file of plists) {
  let txt = readFileSync(file, "utf8");
  const dictAt = txt.indexOf("<dict>");
  if (dictAt === -1) {
    console.log(`[ensure-ios-plist] ${file}: no root <dict>, skipping.`);
    continue;
  }
  let inject = "";
  if (!txt.includes(`<key>${USAGE_KEY}</key>`)) inject += `\n${USAGE_BLOCK}`;
  if (!txt.includes(`<key>${BONJOUR_KEY}</key>`)) inject += `\n${BONJOUR_BLOCK}`;
  if (!inject) {
    console.log(`[ensure-ios-plist] ${file}: keys already present.`);
    continue;
  }
  const at = dictAt + "<dict>".length;
  txt = txt.slice(0, at) + inject + txt.slice(at);
  writeFileSync(file, txt);
  touched++;
  console.log(`[ensure-ios-plist] ${file}: added local-network sync keys.`);
}
console.log(`[ensure-ios-plist] Done (${touched} file(s) updated).`);
