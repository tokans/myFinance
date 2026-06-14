/**
 * Pure builder for the ICE (In Case of Emergency) card. No DB/React — turns a
 * health profile plus emergency contacts into ordered, non-empty display lines
 * and a plain-text export. Tested in ice.test.ts.
 */

export interface IceContact {
  name: string;
  relationship?: string | null;
  phone?: string | null;
}

export interface IceInput {
  fullName?: string | null;
  bloodGroup?: string | null;
  allergies?: string | null;
  conditions?: string | null;
  medications?: string | null;
  organDonor?: boolean;
  contacts: IceContact[];
}

export interface IceLine {
  label: string;
  value: string;
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** Ordered medical lines, omitting any field the user left blank. */
export function buildIceLines(input: IceInput): IceLine[] {
  const lines: IceLine[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const v = clean(value);
    if (v) lines.push({ label, value: v });
  };
  push("Name", input.fullName);
  push("Blood group", input.bloodGroup);
  push("Allergies", input.allergies);
  push("Conditions", input.conditions);
  push("Medications", input.medications);
  if (input.organDonor) lines.push({ label: "Organ donor", value: "Yes" });
  return lines;
}

/** Contacts that are dialable enough to show on the card (must have a phone). */
export function iceContactsWithPhone(contacts: IceContact[]): IceContact[] {
  return contacts.filter((c) => clean(c.phone));
}

/** Plain-text ICE card for printing / export / wallpaper rendering. */
export function iceCardText(input: IceInput): string {
  const lines = buildIceLines(input).map((l) => `${l.label}: ${l.value}`);
  const contacts = iceContactsWithPhone(input.contacts).map(
    (c) => `  • ${c.name}${c.relationship ? ` (${c.relationship})` : ""} — ${clean(c.phone)}`,
  );
  const out = ["IN CASE OF EMERGENCY", "====================", ...lines];
  if (contacts.length) out.push("", "Emergency contacts:", ...contacts);
  out.push(
    "",
    "This card is informational and may be out of date. In an emergency, call local",
    "emergency services and treat based on professional medical judgment.",
  );
  return out.join("\n");
}

/** True when there's nothing worth putting on a card yet. */
export function isIceEmpty(input: IceInput): boolean {
  return buildIceLines(input).length === 0 && iceContactsWithPhone(input.contacts).length === 0;
}
