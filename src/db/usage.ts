import { query, exec, T } from "./client";

export interface LaunchRow {
  id: number;
  /** UTC datetime string, e.g. "2026-06-01 09:14:22". */
  launched_at: string;
}

/** A calendar day with how many times the app was launched that day. */
export interface LaunchDay {
  /** Local 'YYYY-MM-DD'. */
  day: string;
  count: number;
}

export interface LaunchStats {
  totalLaunches: number;
  distinctDays: number;
  firstLaunch: string | null;
  lastLaunch: string | null;
  /** Per-day breakdown, most recent first. */
  days: LaunchDay[];
}

/** Record one app launch. Called once per session on boot. */
export async function recordLaunch(): Promise<void> {
  await exec(`INSERT INTO ${T.appLaunches} (launched_at) VALUES (datetime('now'))`);
}

/** All launches, newest first. */
export async function listLaunches(): Promise<LaunchRow[]> {
  return query<LaunchRow>(`SELECT id, launched_at FROM ${T.appLaunches} ORDER BY launched_at DESC`);
}

/**
 * Convert a stored UTC datetime ("YYYY-MM-DD HH:MM:SS") into the user's local
 * 'YYYY-MM-DD'. SQLite's datetime('now') is UTC; the day boundary that matters
 * for a usage streak is the user's local one, so we shift here rather than in SQL.
 */
function localDay(utc: string): string {
  // Treat the stored value as UTC by appending 'Z' after normalising the space.
  const d = new Date(`${utc.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return utc.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getLaunchStats(): Promise<LaunchStats> {
  const rows = await listLaunches();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const day = localDay(r.launched_at);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days = [...counts.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  return {
    totalLaunches: rows.length,
    distinctDays: days.length,
    // rows are newest-first, so last element is the earliest launch.
    firstLaunch: rows.length ? rows[rows.length - 1].launched_at : null,
    lastLaunch: rows.length ? rows[0].launched_at : null,
    days,
  };
}

/** Number of distinct local days the app has been opened. Drives the tier. */
export async function countDistinctLaunchDays(): Promise<number> {
  const rows = await listLaunches();
  const days = new Set(rows.map((r) => localDay(r.launched_at)));
  return days.size;
}
