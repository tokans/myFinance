import { buildRegisterSnapshot, type RegisterSnapshot } from "@/domain/registerSnapshot";
import { listAccounts } from "@/db/accounts";
import { latestSnapshotPerAccount } from "@/db/aggregates";
import { listPeople } from "@/db/people";
import { getWillMeta } from "@/db/will";

/** Assemble the full register snapshot from the database. Tauri-only. */
export async function gatherSnapshot(generatedOn: string, currency: string): Promise<RegisterSnapshot> {
  const [accounts, latest, people, will] = await Promise.all([
    listAccounts(), latestSnapshotPerAccount(), listPeople(), getWillMeta(),
  ]);
  const valueById = new Map(latest.map((l) => [l.account_id, l.value]));
  const personName = (id: number | null) => people.find((p) => p.id === id)?.name ?? null;

  return buildRegisterSnapshot({
    generatedOn,
    currency,
    accounts: accounts.map((a) => ({
      name: a.name,
      type: a.type,
      institution: a.institution,
      value: valueById.get(a.id) ?? null,
      contact: a.contact,
      emergency_action: a.emergency_action,
    })),
    people: people.map((p) => ({
      name: p.name, relationship: p.relationship, phone: p.phone, email: p.email,
    })),
    will: will
      ? {
          executor: personName(will.executor_person_id),
          location_of_original: will.location_of_original,
          registered: will.registered === 1,
          probate_required: will.probate_required === 1,
        }
      : null,
  });
}
