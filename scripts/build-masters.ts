/**
 * Dev-time master-data generator. Hits no-auth public APIs once and writes the
 * baked static JSON that ships in the app (the offline fallback). Re-run only to
 * refresh the baked data:
 *
 *   npx tsx scripts/build-masters.ts
 *
 * Currencies and institutions are hand-curated (no suitable API) and are left
 * untouched. Network failures are reported and skip that file, leaving the
 * existing checked-in JSON in place.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "masters", "data");

// Countries to seed cities for — keep small; the app fetches the rest live.
const CITY_COUNTRIES: { code: string; name: string }[] = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SG", name: "Singapore" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
];

async function buildCountries(): Promise<void> {
  const res = await fetch("https://restcountries.com/v3.1/all?fields=name,cca2,flag");
  if (!res.ok) throw new Error(`REST Countries ${res.status}`);
  const data = (await res.json()) as Array<{ cca2?: string; flag?: string; name?: { common?: string } }>;
  const out = data
    .filter((c) => c.cca2 && c.name?.common)
    .map((c) => ({ value: c.cca2!, label: c.name!.common!, icon: c.flag }))
    .sort((a, b) => a.label.localeCompare(b.label));
  await writeFile(join(DATA_DIR, "countries.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`countries.json: ${out.length} countries`);
}

async function buildCities(): Promise<void> {
  const seed: Record<string, string[]> = {};
  for (const { code, name } of CITY_COUNTRIES) {
    const res = await fetch("https://countriesnow.space/api/v0.1/countries/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: name }),
    });
    if (!res.ok) {
      console.warn(`  cities ${code}: HTTP ${res.status} — skipped`);
      continue;
    }
    const json = (await res.json()) as { error?: boolean; data?: string[] };
    if (json.error || !Array.isArray(json.data)) {
      console.warn(`  cities ${code}: bad payload — skipped`);
      continue;
    }
    seed[code] = json.data;
    console.log(`  cities ${code}: ${json.data.length}`);
  }
  if (Object.keys(seed).length) {
    await writeFile(join(DATA_DIR, "cities.seed.json"), JSON.stringify(seed, null, 2) + "\n");
    console.log("cities.seed.json written");
  }
}

async function main() {
  try {
    await buildCountries();
  } catch (e) {
    console.error("countries failed, keeping existing:", e instanceof Error ? e.message : e);
  }
  try {
    await buildCities();
  } catch (e) {
    console.error("cities failed, keeping existing:", e instanceof Error ? e.message : e);
  }
}

void main();
