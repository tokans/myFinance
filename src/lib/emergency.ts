/**
 * Helpers for the "Prepare for Emergencies" feature. The deterministic
 * contact-extraction primitives (`mentionsContact`/`telHref`/`mailtoHref`/
 * `hasActionableContact`) now live in the shared core (`sharedcorelib/ice`) and
 * are re-exported here so existing `@/lib/emergency` import sites stay unchanged.
 * The DISCLAIMER copy below is myFinance-specific and stays in the app.
 * Detection is deterministic keyword matching — no LLM (a hard constraint).
 * See [[project_shared_core_extracted]].
 */
export { mentionsContact, telHref, mailtoHref, hasActionableContact } from "sharedcorelib/ice";

/**
 * Disclaimer shown wherever emergency actions/contacts are presented or acted on.
 * Kept in one place so every surface shows the same required wording.
 */
export const EMERGENCY_DISCLAIMER =
  "This is a personal planning aid, not legal, financial, or medical advice. " +
  "Details you enter are stored only on this device and are never verified by the app. " +
  "Confirm every instruction and phone number yourself, and in a real emergency contact the " +
  "relevant institution or local emergency services directly.";
