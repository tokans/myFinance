import { query, exec, T } from "./client";

export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export type FyStartMonth = 1 | 4;

export interface AppSettings {
  currency: string;
  fyStartMonth: FyStartMonth;
  dateFormat: DateFormat;
  theme: "system" | "light" | "dark";
  /** ISO country code of residence (master `country`), or "" if unset. */
  residenceCountry: string;
  /** City of residence (master `city`, scoped to residenceCountry), or "" if unset. */
  residenceCity: string;
}

const DEFAULTS: AppSettings = {
  currency: "INR",
  fyStartMonth: 4,
  dateFormat: "DD/MM/YYYY",
  theme: "system",
  residenceCountry: "IN",
  residenceCity: "",
};

interface Row { key: string; value: string }

export async function loadSettings(): Promise<AppSettings> {
  const rows = await query<Row>(`SELECT key, value FROM ${T.settings}`);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    currency: map.get("currency") ?? DEFAULTS.currency,
    fyStartMonth: (Number(map.get("fy_start_month")) === 1 ? 1 : 4) as FyStartMonth,
    dateFormat: (map.get("date_format") as DateFormat) ?? DEFAULTS.dateFormat,
    theme: (map.get("theme") as AppSettings["theme"]) ?? DEFAULTS.theme,
    residenceCountry: map.get("residence_country") ?? DEFAULTS.residenceCountry,
    residenceCity: map.get("residence_city") ?? DEFAULTS.residenceCity,
  };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  const entries: [string, string][] = [
    ["currency", s.currency],
    ["fy_start_month", String(s.fyStartMonth)],
    ["date_format", s.dateFormat],
    ["theme", s.theme],
    ["residence_country", s.residenceCountry],
    ["residence_city", s.residenceCity],
  ];
  for (const [key, value] of entries) {
    await exec(
      `INSERT INTO ${T.settings} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }
}

export { DEFAULTS as DEFAULT_SETTINGS };

/**
 * Generic single-key access to the settings table, for ancillary estate-planning
 * values (annual income, household monthly expenses, …) that don't belong in the
 * core typed AppSettings. Returns null when unset.
 */
export async function getSetting(key: string): Promise<string | null> {
  const rows = await query<Row>(`SELECT value FROM ${T.settings} WHERE key = ?`, [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await exec(
    `INSERT INTO ${T.settings} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getNumberSetting(key: string): Promise<number | null> {
  const v = await getSetting(key);
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
