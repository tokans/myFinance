/**
 * Ordered scenario registry. Add scenarios here as they're implemented; the
 * recorder records them in this order (and `--all` records every non-`solo` one).
 */
import type { Scenario } from "@mydemo/core";

import basicImport from "./01-basic-import.ts";
import creditDebitImport from "./02-credit-debit-import.ts";
import estateImport from "./03-estate-readiness-import.ts";
import multiColumnImport from "./04-multi-column-import.ts";
import wizardFallback from "./05-wizard-fallback.ts";
import monthlyUpdate from "./06-monthly-update.ts";
import accountAddVault from "./07-account-add-vault.ts";
import goalWithEta from "./08-goal-with-eta.ts";
import reminderEmergency from "./09-reminder-emergency.ts";
import taxItrImport from "./10-tax-itr-import.ts";
import fyStartToggle from "./11-fy-start-toggle.ts";
import excelExport from "./12-excel-export.ts";
import fireCalculator from "./13-fire-calculator.ts";
import peopleInsuranceGap from "./14-people-insurance-gap.ts";
import healthIceCard from "./15-health-ice-card.ts";
import estateFamilyPack from "./16-estate-family-pack.ts";
import fullTutorial from "./20-full-tutorial.ts";

export const SCENARIOS: Scenario[] = [
  basicImport,
  creditDebitImport,
  estateImport,
  multiColumnImport,
  wizardFallback,
  monthlyUpdate,
  accountAddVault,
  goalWithEta,
  reminderEmergency,
  taxItrImport,
  fyStartToggle,
  excelExport,
  fireCalculator,
  peopleInsuranceGap,
  healthIceCard,
  estateFamilyPack,
  fullTutorial,
];
