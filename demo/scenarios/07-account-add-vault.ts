/**
 * 07 — Add an account, then attach a credential in the vault.
 * Create an account via the form, open its detail page, and fill in an
 * encrypted-vault credential (the vault auto-unlocks in demo mode).
 *
 * NOTE: the recording stops at the filled credential form and does NOT click
 * Save. Under the automated debug build, tauri-plugin-stronghold's snapshot
 * write (`stronghold.save()`) deadlocks — the credential inserts but save()
 * never resolves, leaving a stuck "Saving…". The FK bug that previously broke
 * attach was fixed (src/db/accounts.ts). The save round-trip should be verified
 * by a manual capture / release build — see DEMO.md.
 */
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "07-account-add-vault",
  title: "Add account + vault credential",
  shows:
    "Add an account from the form → open its detail page → fill an encrypted " +
    "credential for the Stronghold vault.",

  async run(h) {
    h.log("open Accounts");
    await h.click("nav-accounts");
    await h.pause(800);

    h.log("add an account");
    await h.click("account-add-button");
    await h.waitFor("account-form-name");
    await h.type("account-form-name", "HDFC Savings");
    await h.pause(1000);
    await h.click("account-form-submit");

    h.log("open the account");
    await h.waitFor("account-row");
    await h.pause(800);
    await h.click("account-row");

    h.log("attach a credential");
    await h.waitFor("credential-attach");
    await h.pause(900);
    await h.click("credential-attach");
    await h.waitFor("credential-label");
    await h.type("credential-label", "HDFC NetBanking");
    await h.pause(600);
    await h.type("credential-username", "arjun.verma");
    await h.pause(600);
    await h.type("credential-password", "S3cr3t-demo");
    // Linger on the filled form. (Save is intentionally not clicked — see header.)
    await h.pause(2600);
  },
};

export default scenario;
