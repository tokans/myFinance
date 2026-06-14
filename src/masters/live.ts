import { isTauri } from "@/lib/environment";
import { getCommonBaked } from "sharedcorelib/masters";
import type { MasterOption } from "./types";

/**
 * No-auth public-API fetchers. They run only inside Tauri and go through the
 * Tauri HTTP plugin (Rust side), which bypasses the webview CSP and CORS — the
 * locked-down `connect-src` in tauri.conf.json stays unchanged. Any failure
 * (offline, non-Tauri, bad response) resolves to `null` so the store silently
 * keeps the baked static data. See `src-tauri/capabilities/default.json` for the
 * scoped URL allowlist.
 */

async function tauriFetch(input: string, init?: RequestInit): Promise<Response | null> {
  if (!isTauri()) return null;
  try {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return await fetch(input, init);
  } catch {
    return null;
  }
}

/** Live country list from REST Countries (https://restcountries.com), no auth. */
export async function fetchCountries(): Promise<MasterOption[] | null> {
  const res = await tauriFetch("https://restcountries.com/v3.1/all?fields=name,cca2,flag");
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as Array<{
      cca2?: string;
      flag?: string;
      name?: { common?: string };
    }>;
    const out = data
      .filter((c) => c.cca2 && c.name?.common)
      .map<MasterOption>((c) => ({
        value: c.cca2!,
        label: c.name!.common!,
        icon: c.flag,
        source: "live",
      }));
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// Country code → name, sourced from the shared common masters (the app no longer
// ships its own countries.json — see sharedcorelib `getCommonBaked`).
const NAME_BY_CODE = new Map(
  getCommonBaked("country").map((c) => [c.value, c.label]),
);

/**
 * Live cities for a country from countriesnow.space (no auth, POST). `parent` is
 * the ISO country code; the API keys by country name, so we resolve the name from
 * the baked country list first.
 */
export async function fetchCities(parent: string | null): Promise<MasterOption[] | null> {
  if (!parent) return null;
  const country = NAME_BY_CODE.get(parent);
  if (!country) return null;
  const res = await tauriFetch("https://countriesnow.space/api/v0.1/countries/cities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country }),
  });
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { error?: boolean; data?: string[] };
    if (data.error || !Array.isArray(data.data)) return null;
    const out = data.data.map<MasterOption>((city) => ({
      value: city,
      label: city,
      source: "live",
    }));
    return out.length ? out : null;
  } catch {
    return null;
  }
}
