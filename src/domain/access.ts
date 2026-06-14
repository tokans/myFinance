/**
 * Pure check-in / staleness logic for progressive access (Feature 9). The
 * "dead-man's switch" is reduced to a local staleness flag (no backend). Tested
 * in access.test.ts.
 */

/** Days since the last check-in. Negative/zero treated as 0. */
export function daysSinceCheckin(lastCheckin: string | null | undefined, today: string): number | null {
  if (!lastCheckin) return null;
  const a = lastCheckin.slice(0, 10);
  const [ay, am, ad] = a.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if (!ay || !ty) return null;
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(ay, am - 1, ad);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** True when the user hasn't checked in within `thresholdDays` (default 90). */
export function isCheckinStale(
  lastCheckin: string | null | undefined,
  today: string,
  thresholdDays = 90,
): boolean {
  const d = daysSinceCheckin(lastCheckin, today);
  if (d == null) return false; // never checked in → not "stale", just unset
  return d >= thresholdDays;
}
