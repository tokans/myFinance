import { query, exec, getDb, T } from "./client";
import type { LifeEventType } from "@/domain/review";

export interface LifeEvent {
  id: number;
  type: LifeEventType;
  event_date: string | null;
  notes: string | null;
  created_at: string;
}

export async function listLifeEvents(): Promise<LifeEvent[]> {
  return query<LifeEvent>(`SELECT * FROM ${T.lifeEvents} ORDER BY event_date DESC, id DESC`);
}

export async function addLifeEvent(type: LifeEventType, eventDate: string | null, notes: string | null): Promise<number> {
  const db = await getDb();
  const r = await db.execute(
    `INSERT INTO ${T.lifeEvents} (type, event_date, notes) VALUES (?, ?, ?)`,
    [type, eventDate || null, notes?.trim() || null],
  );
  return Number(r.lastInsertId);
}

export async function deleteLifeEvent(id: number): Promise<void> {
  await exec(`DELETE FROM ${T.lifeEvents} WHERE id = ?`, [id]);
}

/** Delete every recorded life event. */
export async function clearAllLifeEvents(): Promise<void> {
  await exec(`DELETE FROM ${T.lifeEvents}`);
}
