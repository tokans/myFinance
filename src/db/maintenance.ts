import { query, T } from "./client";
import { clearAllAccounts } from "./accounts";
import { clearAllSnapshots } from "./snapshots";
import { clearAllTax } from "./tax";
import { clearAllGoals } from "./goals";
import { clearAllPeople } from "./people";
import { clearHealthProfile } from "./health";
import { clearAllPolicies } from "./insurance";
import { clearAllHoldings } from "./holdings";
import { clearAllDocuments } from "./documents";
import { clearWillMeta } from "./will";
import { clearIncapacityMeta } from "./incapacity";
import { clearAllGrants } from "./access";
import { clearAllLifeEvents } from "./lifeEvents";
import { clearAllReminders } from "./reminders";

/**
 * Wipe every user-data table: accounts and monthly values, tax, goals, people,
 * the estate suite (health, insurance, holdings, documents, Will, incapacity,
 * access grants + audit, life events) and reminders.
 *
 * Intentionally preserved: app settings, the credential vault (`vault_entries`
 * + Stronghold), local usage telemetry (`app_launches`) and OTA reference data
 * (`master_options` / `partners` / `custom_options`).
 *
 * Child tables that reference `people`/`accounts` are cleared before their
 * parents so the deletes never trip a foreign-key constraint regardless of the
 * table's ON DELETE behaviour.
 */
export async function clearAllData(): Promise<void> {
  await clearAllDocuments(); // also removes encrypted blob files
  await clearAllHoldings();
  await clearAllGrants();
  await clearAllPolicies();
  await clearAllLifeEvents();
  await clearWillMeta();
  await clearIncapacityMeta();
  await clearHealthProfile();
  await clearAllReminders();
  await clearAllTax();
  await clearAllGoals();
  await clearAllSnapshots();
  await clearAllAccounts();
  await clearAllPeople();
}

/**
 * Total rows across every user-data table cleared by {@link clearAllData} — used
 * to gate the Settings "Clear all data" action (hidden when the app is empty).
 */
export async function countAllData(): Promise<number> {
  // health_profile is excluded: it is no longer an app table — the medical card
  // lives on the shared common ICE card (invariant 6), cleared via clearHealthProfile().
  const rows = await query<{ n: number }>(
    `SELECT
        (SELECT COUNT(*) FROM ${T.accounts})
      + (SELECT COUNT(*) FROM ${T.monthlySnapshot})
      + (SELECT COUNT(*) FROM ${T.taxYears})
      + (SELECT COUNT(*) FROM ${T.goals})
      + (SELECT COUNT(*) FROM ${T.people})
      + (SELECT COUNT(*) FROM ${T.insurancePolicies})
      + (SELECT COUNT(*) FROM ${T.holdings})
      + (SELECT COUNT(*) FROM ${T.documents})
      + (SELECT COUNT(*) FROM ${T.willMeta})
      + (SELECT COUNT(*) FROM ${T.incapacityMeta})
      + (SELECT COUNT(*) FROM ${T.accessGrants})
      + (SELECT COUNT(*) FROM ${T.lifeEvents})
      + (SELECT COUNT(*) FROM ${T.reminders}) AS n`,
  );
  return rows[0]?.n ?? 0;
}
