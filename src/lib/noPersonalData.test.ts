/**
 * Repo guard: no real personal data in anything git tracks.
 *
 * This exists because it already happened. Fixtures for the AIS, Form 16 and
 * bank-statement parsers were transcribed straight out of the owner's own
 * documents, which put a real PAN, a real IP address, real employer and
 * holding names, a real salary figure and real UPI references into test files
 * headed for a public GitHub repo. Parser tests only care about LAYOUT — cell
 * positions, wrap behaviour, column alignment — so real values buy nothing and
 * cost privacy.
 *
 * The scanner is `sharedcorelib/pii`'s, the same deterministic engine the
 * egress guard uses (invariant 7), rather than a second set of patterns that
 * could drift from it. Only the kinds that actually leak from Indian tax and
 * banking documents are enforced — PAN, Aadhaar and IP, plus TAN, which the
 * core engine has no detector for. `phone` and `creditcard` are deliberately
 * left out: any long digit run in source (a timestamp, a hash, a coordinate)
 * trips them, and a guard that cries wolf is a guard that gets deleted.
 *
 * Adding a value here is meant to be a conscious act. If a test needs a new
 * identifier, invent one in the obvious placeholder style and add it below.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanText, type PiiKind } from "sharedcorelib/pii";

/** Invented identifiers that appear in fixtures. Every one of these is fake;
 *  none corresponds to a real taxpayer or deductor. */
const ALLOWED = new Set<string>([
  // PAN-shaped (5 letters, 4 digits, 1 letter)
  "AAAAA1111A",
  "AAACA0000A",
  "AAACB1111B",
  "AAAPA0000A",
  "AAAPA1111A",
  "ABCDE1234F",
  "ABCPD1234E",
  "BBBBB2222B",
  "BBBPB2222B",
  "CCCCC3333C",
  "PQRSU5678G",
  "ZZZZZ0000Z",
  // TAN-shaped (4 letters, 5 digits, 1 letter)
  "AAAA11111A",
  "ABCD12345E",
  "ACME01234B",
  "BBBB22222B",
  "BLRA00123E",
  "BLRE00005E",
  "CHEC00003C",
  "DELA00001A",
  "DELA12345A",
  "MUMA00001A",
  "MUMB00002B",
  "MUMD00004D",
  "PNEA00003A",
  "SRTA00004A",
  "WXYZ98765F",
  "ZZZZ99999Z",
  // Twelve-digit runs the Aadhaar detector flags that are not Aadhaar: a
  // placeholder phone number, and two passwords derived from the placeholder
  // PAN + date of birth by `passwordCandidates.ts`.
  "919876543210",
  "789015051990",
  "150519907890",
]);

/**
 * An address is acceptable only if it can't identify a real host: loopback,
 * the RFC 1918 private ranges, link-local, broadcast/unspecified, and the
 * RFC 5737 documentation ranges reserved precisely for examples. Judged by
 * range rather than by enumeration so a developer's own LAN address can never
 * be added to an allowlist by reflex — it simply isn't allowed.
 */
function isNonIdentifyingIp(value: string): boolean {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;
  const [a, b] = octets;
  if (a === 0 || a === 127 || a === 255) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 0 && octets[2] === 2) return true; // 192.0.2.0/24
  if (a === 198 && b === 51 && octets[2] === 100) return true; // 198.51.100.0/24
  if (a === 203 && b === 0 && octets[2] === 113) return true; // 203.0.113.0/24
  return false;
}

const ENFORCED: PiiKind[] = ["pan", "aadhaar", "ip"];

/** TAN has no detector in the core engine — it is specific to Indian tax
 *  documents, which is precisely the corpus this repo parses. */
const TAN = /\b[A-Z]{4}[0-9]{5}[A-Z]\b/g;

/**
 * The owner's own name, which has no business being fixture data.
 *
 * It leaked into an ICE card, a Will, a document-vault blob, self-transfer
 * narrations and password-derivation inputs — the audit's shape-based
 * detectors caught none of it, because a name has no shape. Scoped to `src/`
 * on purpose: LICENSE, the GitHub workflows and the docs all name the author
 * legitimately, and that is not what this guard is about.
 */
const OWNER_NAME = /\bAnshuman\b/i;
const NAME_SCOPE = /^src\//;

const SCANNABLE = /\.(ts|tsx|js|jsx|cjs|mjs|json|md|rs|sql|html|css|yml|yaml)$/;
const SKIP = /package-lock\.json|\/dist\/|node_modules/;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: process.cwd() })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f && SCANNABLE.test(f) && !SKIP.test(f));
}

interface Violation {
  file: string;
  line: number;
  kind: string;
  value: string;
}

function scanRepo(): Violation[] {
  const violations: Violation[] = [];

  for (const file of trackedFiles()) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable or binary — nothing to scan
    }

    text.split("\n").forEach((lineText, i) => {
      for (const match of scanText(lineText)) {
        if (!ENFORCED.includes(match.kind)) continue;
        if (ALLOWED.has(match.value)) continue;
        if (match.kind === "ip" && isNonIdentifyingIp(match.value)) continue;
        violations.push({ file, line: i + 1, kind: match.kind, value: match.value });
      }

      TAN.lastIndex = 0;
      for (let m = TAN.exec(lineText); m; m = TAN.exec(lineText)) {
        if (ALLOWED.has(m[0])) continue;
        violations.push({ file, line: i + 1, kind: "tan", value: m[0] });
      }

      if (NAME_SCOPE.test(file)) {
        const name = OWNER_NAME.exec(lineText);
        if (name) violations.push({ file, line: i + 1, kind: "owner-name", value: name[0] });
      }
    });
  }

  return violations;
}

describe("no personal data in tracked files", () => {
  it("finds no PAN, TAN, Aadhaar or non-documentation IP outside the placeholder allowlist", () => {
    const violations = scanRepo();
    const report = violations.map((v) => `${v.file}:${v.line}  ${v.kind}  ${v.value}`).join("\n");
    expect(report, `Real personal data must never be committed. Replace with an invented placeholder and add it to ALLOWED in this file.\n\n${report}`).toBe("");
  });
});
