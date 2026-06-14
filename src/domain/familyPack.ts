/**
 * Pure "what-if" family briefing builder (Feature 11). Turns a register snapshot
 * into a plain-text briefing for one designated person, with optional number
 * redaction. No DB/React. Tested in familyPack.test.ts.
 */
import type { RegisterSnapshot } from "./registerSnapshot";

export interface BriefingOptions {
  designatedPerson?: string;
  /** When true, account values are hidden (show "—"). */
  redactNumbers?: boolean;
}

function money(value: number | null | undefined, currency: string, redact: boolean): string {
  if (redact) return "—";
  if (value == null) return "—";
  return `${currency} ${Math.round(value).toLocaleString("en-IN")}`;
}

export function buildBriefing(snapshot: RegisterSnapshot, opts: BriefingOptions = {}): string {
  const redact = !!opts.redactNumbers;
  const who = opts.designatedPerson?.trim() || "my family";
  const lines: string[] = [];

  lines.push(`"WHAT IF" BRIEFING — for ${who}`);
  lines.push(`Generated ${snapshot.generatedOn}`);
  lines.push("");

  if (snapshot.will) {
    lines.push("WILL");
    if (snapshot.will.executor) lines.push(`  Executor: ${snapshot.will.executor}`);
    if (snapshot.will.location_of_original) lines.push(`  Original kept at: ${snapshot.will.location_of_original}`);
    lines.push(`  Registered: ${snapshot.will.registered ? "yes" : "no"}; probate likely required: ${snapshot.will.probate_required ? "yes" : "no"}`);
    lines.push("");
  }

  lines.push(`ACCOUNTS (${snapshot.accounts.length})`);
  for (const a of snapshot.accounts) {
    lines.push(`  • ${a.name} [${a.type}]${a.institution ? ` — ${a.institution}` : ""}: ${money(a.value, snapshot.currency, redact)}`);
    if (a.emergency_action) lines.push(`      Action: ${a.emergency_action}`);
    if (a.contact) lines.push(`      Contact: ${a.contact}`);
  }
  lines.push("");

  if (snapshot.people.length) {
    lines.push("KEY PEOPLE");
    for (const p of snapshot.people) {
      const bits = [p.relationship, p.phone, p.email].filter(Boolean).join(" · ");
      lines.push(`  • ${p.name}${bits ? ` — ${bits}` : ""}`);
    }
    lines.push("");
  }

  lines.push(
    "This briefing is informational and may be out of date. Verify every detail; for legal or",
    "financial steps consult the named professionals or a qualified advisor.",
  );
  return lines.join("\n");
}
