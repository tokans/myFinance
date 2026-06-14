import { openExternal } from "@/lib/openExternal";

/**
 * Donation ("Become a Patron") and partner-signup links.
 *
 * The donation itself runs on tokans.org/donate (Razorpay-backed). Because the
 * app has no backend, completion is NOT confirmed by a callback — instead, after
 * payment tokans.org emails the user a signed+encrypted file which they drop into
 * their Downloads folder; the app verifies and loads it on the next launch (see
 * lib/patronFile.ts). So the donate button only opens the page and flips the user
 * into the "awaiting file / restart" state.
 */

/** Hosted donation page (Razorpay lives here). */
export const DONATE_URL = "https://www.tokans.org/donate";

/** Partner onboarding site (future scope — separate signup + app module). */
export const PARTNER_SIGNUP_URL = "https://www.tokans.org/professionals/signup";

/** Open the hosted donation page in the user's browser. */
export async function openDonatePage(): Promise<void> {
  await openExternal(DONATE_URL);
}

/** Open the professional partner signup site in the user's browser. */
export async function openPartnerSignup(): Promise<void> {
  await openExternal(PARTNER_SIGNUP_URL);
}
