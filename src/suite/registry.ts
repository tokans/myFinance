/**
 * The published-apps registry source for the marketplace. Reads the cached signed
 * registry (delivered over the air as a `registry` suite target) and falls back to /
 * unions in the baked seed so the current app is always present even before any OTA
 * update. The cache is plain client-local storage — receive-only, never uploaded.
 */
import type { PublishedApp } from "sharedcorelib/suite";
import { SEED_PUBLISHED_APPS } from "./config";

const CACHE_KEY = "suite:registry";

/** All published apps: OTA registry (if cached) unioned over the baked seed. */
export async function listPublishedApps(): Promise<PublishedApp[]> {
  let cached: PublishedApp[] | null = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw) as PublishedApp[];
  } catch {
    cached = null;
  }
  if (!cached || cached.length === 0) return SEED_PUBLISHED_APPS;
  // OTA registry wins; keep any seed apps it omits so the current app never vanishes.
  const byId = new Map(cached.map((a) => [a.appId, a] as const));
  for (const seed of SEED_PUBLISHED_APPS) if (!byId.has(seed.appId)) byId.set(seed.appId, seed);
  return [...byId.values()];
}

/** Persist a freshly-verified registry from a suite `registry` target. */
export function cachePublishedApps(apps: PublishedApp[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(apps));
  } catch {
    /* ignore — storage full / unavailable */
  }
}
