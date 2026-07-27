import { getSetting, setSetting } from "@/db/settings";
import { createPatronStore, type PatronState } from "sharedcorelib/grant";

/**
 * Patron / Partner state, persisted in the generic settings key-value table
 * (no migration needed). The mechanism — the `patron_since` / `patron_pending` /
 * `partner_since` keys, the Partner-offer window math, and the get/record/pending
 * operations — lives in the shared core (`sharedcorelib/grant` → `createPatronStore`).
 * This file binds it to myFinance's settings get/set adapter and re-exports the
 * function-style API the existing call sites use.
 *
 * - `patron_since`   — donation date 'YYYY-MM-DD'. Presence ⇒ Patron (permanent).
 * - `patron_pending` — "1" once the donation page is opened but no file has loaded
 *                      yet; drives the "Restart after Donation" CTA.
 * - `partner_since`  — enrollment date 'YYYY-MM-DD'. Presence ⇒ Partner (outranks
 *                      Patron). Both grants ride the shared receive-only handoff.
 */
const store = createPatronStore({ get: getSetting, set: setSetting });

export { PARTNER_WINDOW_MONTHS, partnerWindowOpen, type PatronState } from "sharedcorelib/grant";

/**
 * Assemble the current patron state. `today` ('YYYY-MM-DD') is passed in so the
 * window math stays testable; callers pass the local date.
 */
export function getPatronState(today: string): Promise<PatronState> {
  return store.getState(today);
}

/**
 * Record a donation (from a verified file). Stores the donation date and clears
 * the pending flag. Idempotent.
 */
export function recordDonation(donationDate: string): Promise<void> {
  return store.recordDonation(donationDate);
}

/**
 * Record a professional Partner enrollment (from a verified Partner grant). Stores
 * the enrollment date and clears any pending donation flag. Idempotent.
 */
export function recordPartner(enrolledDate: string): Promise<void> {
  return store.recordPartner(enrolledDate);
}

/** Mark that the user has opened the donation page and is awaiting the file. */
export function markDonationPending(): Promise<void> {
  return store.markDonationPending();
}
