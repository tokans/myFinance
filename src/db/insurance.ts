import { query, exec, getDb, T } from "./client";
import type { PolicyKind } from "@/domain/insurance";

export interface InsurancePolicy {
  id: number;
  account_id: number | null;
  kind: PolicyKind;
  insurer: string;
  policy_no: string | null;
  sum_assured: number;
  premium: number | null;
  renewal_date: string | null;
  tpa: string | null;
  network_hospitals: string | null;
  claims_contact_person_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface InsurancePolicyInput {
  kind: PolicyKind;
  insurer: string;
  policy_no?: string | null;
  sum_assured: number;
  premium?: number | null;
  renewal_date?: string | null;
  tpa?: string | null;
  network_hospitals?: string | null;
  claims_contact_person_id?: number | null;
  account_id?: number | null;
  notes?: string | null;
}

export async function listPolicies(): Promise<InsurancePolicy[]> {
  return query<InsurancePolicy>(`SELECT * FROM ${T.insurancePolicies} ORDER BY kind, insurer COLLATE NOCASE`);
}

export async function createPolicy(input: InsurancePolicyInput): Promise<number> {
  const db = await getDb();
  const r = await db.execute(
    `INSERT INTO ${T.insurancePolicies}
       (account_id, kind, insurer, policy_no, sum_assured, premium, renewal_date, tpa, network_hospitals, claims_contact_person_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.account_id ?? null,
      input.kind,
      input.insurer.trim(),
      input.policy_no?.trim() || null,
      input.sum_assured ?? 0,
      input.premium ?? null,
      input.renewal_date || null,
      input.tpa?.trim() || null,
      input.network_hospitals?.trim() || null,
      input.claims_contact_person_id ?? null,
      input.notes?.trim() || null,
    ],
  );
  return Number(r.lastInsertId);
}

export async function updatePolicy(id: number, input: InsurancePolicyInput): Promise<void> {
  await exec(
    `UPDATE ${T.insurancePolicies} SET
        account_id = ?, kind = ?, insurer = ?, policy_no = ?, sum_assured = ?, premium = ?,
        renewal_date = ?, tpa = ?, network_hospitals = ?, claims_contact_person_id = ?, notes = ?
      WHERE id = ?`,
    [
      input.account_id ?? null,
      input.kind,
      input.insurer.trim(),
      input.policy_no?.trim() || null,
      input.sum_assured ?? 0,
      input.premium ?? null,
      input.renewal_date || null,
      input.tpa?.trim() || null,
      input.network_hospitals?.trim() || null,
      input.claims_contact_person_id ?? null,
      input.notes?.trim() || null,
      id,
    ],
  );
}

export async function deletePolicy(id: number): Promise<void> {
  await exec(`DELETE FROM ${T.insurancePolicies} WHERE id = ?`, [id]);
}

/** Delete every insurance policy. */
export async function clearAllPolicies(): Promise<void> {
  await exec(`DELETE FROM ${T.insurancePolicies}`);
}
