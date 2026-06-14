import { query, exec, getDb, T } from "./client";
import type { HoldingRole } from "@/domain/nominations";

export type HoldingMode = "single" | "joint" | "either_or_survivor" | "former_or_survivor";

export const HOLDING_MODES: { value: HoldingMode; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "joint", label: "Jointly" },
  { value: "either_or_survivor", label: "Either or survivor" },
  { value: "former_or_survivor", label: "Former or survivor" },
];

export interface Holding {
  id: number;
  account_id: number;
  person_id: number;
  role: HoldingRole;
  share_pct: number | null;
  position: number | null;
  sec39_beneficial: number;
  created_at: string;
}

export interface HoldingWithPerson extends Holding {
  person_name: string;
  relationship: string | null;
}

export interface HoldingInput {
  account_id: number;
  person_id: number;
  role?: HoldingRole;
  share_pct?: number | null;
  sec39_beneficial?: boolean;
}

export async function listHoldings(): Promise<Holding[]> {
  return query<Holding>(`SELECT * FROM ${T.holdings}`);
}

export async function listHoldingsWithPeople(): Promise<HoldingWithPerson[]> {
  return query<HoldingWithPerson>(
    `SELECT h.*, p.name AS person_name, p.relationship AS relationship
       FROM ${T.holdings} h JOIN ${T.people} p ON p.id = h.person_id
      ORDER BY h.account_id, h.position, h.id`,
  );
}

export async function addHolding(input: HoldingInput): Promise<number> {
  const db = await getDb();
  const r = await db.execute(
    `INSERT INTO ${T.holdings} (account_id, person_id, role, share_pct, sec39_beneficial)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.account_id,
      input.person_id,
      input.role ?? "nominee",
      input.share_pct ?? null,
      input.sec39_beneficial ? 1 : 0,
    ],
  );
  return Number(r.lastInsertId);
}

export async function deleteHolding(id: number): Promise<void> {
  await exec(`DELETE FROM ${T.holdings} WHERE id = ?`, [id]);
}

/** Delete every holding (nominee/co-holder/beneficiary link). */
export async function clearAllHoldings(): Promise<void> {
  await exec(`DELETE FROM ${T.holdings}`);
}

export async function setHoldingMode(accountId: number, mode: HoldingMode | null): Promise<void> {
  await exec(`UPDATE ${T.accounts} SET holding_mode = ? WHERE id = ?`, [mode, accountId]);
}
