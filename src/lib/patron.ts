import { getSetting, setSetting } from "@/db/settings";

/**
 * Patron / Partner state, persisted in the generic settings key-value table
 * (no migration needed):
 *
 * - `patron_since`   — donation date 'YYYY-MM-DD', written when a valid donation
 *                      file is loaded from Downloads. Presence ⇒ Patron (permanent).
 * - `patron_pending` — "1" once the user has opened the donation page but no file
 *                      has been loaded yet; drives the "Restart after Donation" CTA.
 * - `partner_since`  — enrollment date 'YYYY-MM-DD', written when a valid Partner
 *                      grant is loaded from Downloads. Presence ⇒ Partner (outranks
 *                      Patron). Both grants ride the shared receive-only handoff.
 *
 * The "Become a Partner" upgrade is offered only within PARTNER_WINDOW_MONTHS of
 * the donation date; after that the offer can be re-opened by donating again.
 */
const PATRON_KEY = "patron_since";
const PENDING_KEY = "patron_pending";
const PARTNER_KEY = "partner_since";

/** Months after the donation date during which the Partner upgrade is offered. */
export const PARTNER_WINDOW_MONTHS = 3;

export interface PatronState {
  /** Permanent once a donation file has been loaded. */
  isPatron: boolean;
  /** Donation date 'YYYY-MM-DD', or null. */
  donationDate: string | null;
  /** True while within the Partner-offer window after the donation. */
  partnerOfferActive: boolean;
  /** Donation page opened, awaiting the file + a restart. */
  pending: boolean;
  /** Set by the future external partner module. */
  isPartner: boolean;
}

/** True if `today` is strictly before donationDate + PARTNER_WINDOW_MONTHS. Both 'YYYY-MM-DD'. */
export function partnerWindowOpen(donationDate: string, today: string): boolean {
  const start = new Date(`${donationDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return false;
  const expiry = new Date(start);
  expiry.setUTCMonth(expiry.getUTCMonth() + PARTNER_WINDOW_MONTHS);
  return new Date(`${today}T00:00:00Z`) < expiry;
}

/**
 * Assemble the current patron state. `today` ('YYYY-MM-DD') is passed in so the
 * window math stays testable; callers pass the local date.
 */
export async function getPatronState(today: string): Promise<PatronState> {
  const [patronSince, partnerSince, pending] = await Promise.all([
    getSetting(PATRON_KEY),
    getSetting(PARTNER_KEY),
    getSetting(PENDING_KEY),
  ]);
  const donationDate = patronSince || partnerSince || null;
  const isPatron = !!donationDate;
  return {
    isPatron,
    donationDate,
    partnerOfferActive: isPatron && !!donationDate && partnerWindowOpen(donationDate, today),
    pending: pending === "1" && !isPatron,
    isPartner: !!partnerSince,
  };
}

/**
 * Record a donation (from a verified file). Stores the donation date and clears
 * the pending flag. Idempotent — re-loading the same file just rewrites the date,
 * and a newer date re-opens the Partner window.
 */
export async function recordDonation(donationDate: string): Promise<void> {
  await setSetting(PATRON_KEY, donationDate);
  await setSetting(PENDING_KEY, "0");
}

/**
 * Record a professional Partner enrollment (from a verified Partner grant). Stores
 * the enrollment date and clears any pending donation flag — a Partner outranks and
 * implies Patron-level access. Idempotent.
 */
export async function recordPartner(enrolledDate: string): Promise<void> {
  await setSetting(PARTNER_KEY, enrolledDate);
  await setSetting(PENDING_KEY, "0");
}

/** Mark that the user has opened the donation page and is awaiting the file. */
export async function markDonationPending(): Promise<void> {
  await setSetting(PENDING_KEY, "1");
}
