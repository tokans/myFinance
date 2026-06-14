/**
 * Builds a self-contained, print-optimised HTML report of a FIRE plan and prints
 * it to PDF using the webview's own print engine (WebView2 "Save as PDF" on
 * Windows desktop, the browser print dialog in `npm run dev`). No PDF dependency
 * and no backend — the report is assembled from the same pure projection the
 * results screen shows, so it always matches what the user sees.
 *
 * The report spells out every modelling choice ("all the logic chosen"): the
 * location cost-of-living / PPP factor and its basis, the rent-vs-own housing
 * model, dependant cost windows, risk assumptions, and the resulting corpus and
 * sensitivities. It is only offered once the second-pass (housing) questions are
 * answered — see the gating in Fire.tsx.
 */

import { formatMoney } from "@/lib/format";
import { currencyForCountry } from "@/lib/countryCurrency";
import { cityCostIndex, cityCostTier, COST_TIER_LABEL, type CostTier } from "@/lib/cityCost";
import { locationCostFactor } from "@/domain/locationCost";
import { RISK_PROFILES, FIRE_VARIANT_LABEL, type RiskProfile } from "@/domain/fire";
import type { FireView } from "@/domain/fireForm";
// The HTML→PDF print harness + HTML escaper now live in the shared core; the FIRE
// report TEMPLATE below stays app-specific. See [[project_shared_core_extracted]].
import { escapeHtml, printHtmlAsPdf } from "sharedcorelib/report";

export { printHtmlAsPdf };

/** The form subset the report reads. FormState is structurally assignable. */
export interface FireReportForm {
  currentAge: number;
  targetAge: number;
  country: string;
  city: string;
  retirementCountry: string;
  retirementCity: string;
  retirementLocation: string;
  lifestyle: string;
  household: string;
  monthlySpendRetirement: number;
  currentNetWorth: number;
  annualIncome: number;
  annualSavings: number;
  risk: RiskProfile;
  userLifeExpectancy: number;
  childIndependenceAge: number;
  annualGuaranteedIncome: number;
  retirementSpendIncludesDependants: boolean;
  housingChoice: "rent" | "own";
  housingIncludesRent: boolean;
  monthlyRent: number;
  monthlySocietyFees: number;
  annualPropertyTax: number;
  monthlyRentalIncome: number;
  homeTierOverride: CostTier | null;
  retirementTierOverride: CostTier | null;
  manualLocationFactorPct: number | null;
  dependants: { type: string; age: number; future: boolean }[];
}

const esc = escapeHtml;

function tierLabel(country: string, city: string, override: CostTier | null): string {
  if (override) return `${COST_TIER_LABEL[override]} (manual)`;
  if (!city) return "—";
  const { index, known } = cityCostIndex(country, city);
  const t = cityCostTier(index);
  return known ? COST_TIER_LABEL[t] : `${COST_TIER_LABEL[t]} (assumed)`;
}

/** A labelled key/value row helper for the report tables. */
const row = (k: string, v: string): string =>
  `<tr><td class="k">${esc(k)}</td><td class="v">${v}</td></tr>`;

/** Assemble the full report HTML document (inline styles, self-contained). */
export function buildFireReportHtml(
  form: FireReportForm,
  view: FireView,
  currency: string,
  generatedOn: string,
): string {
  const { sim, variant, sensitivity } = view;
  const fmt = (n: number) => formatMoney(n, currency);
  const retCurrency = currencyForCountry(form.retirementCountry) || currency;
  const crossCurrency = retCurrency !== currency;

  const loc = locationCostFactor({
    homeCountry: form.country,
    homeCity: form.city,
    retirementCountry: form.retirementCountry,
    retirementCity: form.retirementCity,
    retirementUndecided: form.retirementLocation === "undecided" || !form.retirementCountry,
    manualLocationFactorPct: form.manualLocationFactorPct,
    homeTierOverride: form.homeTierOverride,
    retirementTierOverride: form.retirementTierOverride,
  });
  const basisText =
    loc.basis === "manual" ? "manual override"
      : loc.basis === "ppp" ? `purchasing-power parity (${currency} ↔ ${retCurrency})`
        : loc.basis === "col" ? "city cost-of-living gap"
          : "no relocation (same as today)";

  const risk = RISK_PROFILES[form.risk];
  const requiredMonthly = sim.currentMonthlySavings + sim.requiredAdditionalMonthlySavings;
  const horizonYears = Math.max(0, form.targetAge - form.currentAge);

  const housingText = form.housingChoice === "own"
    ? `Own home — society/maintenance ${fmt(form.monthlySocietyFees)}/mo + property tax ${fmt(form.annualPropertyTax)}/yr (no rent).`
    : `Renting — ${fmt(form.monthlyRent)}/mo${form.housingIncludesRent ? " (already included in the monthly spend above)" : " (added on top of the monthly spend above)"}.`;

  const deps = form.dependants.length
    ? form.dependants.map((d) =>
        `<li>${esc(d.type)}${d.future ? " (future)" : ""} — age ${d.age} today</li>`).join("")
    : "<li>None</li>";

  const sensitivityRows = sensitivity.map((s) =>
    `<tr><td>${esc(s.scenario)}</td><td class="num">${(s.realReturn * 100).toFixed(1)}%</td>`
    + `<td class="num">${fmt(s.corpus)}</td><td class="num">${s.fireAge != null ? s.fireAge.toFixed(1) : "—"}</td></tr>`
  ).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FIRE plan report</title>
<style>
  :root { --ink:#1a1a1a; --muted:#666; --line:#ddd; --accent:#b45309; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: var(--ink); margin: 0; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 2px solid var(--accent); color: var(--accent); }
  .sub { color: var(--muted); font-size: 12px; margin: 0 0 4px; }
  .hero { margin: 16px 0; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: #fafafa; }
  .hero .num { font-size: 30px; font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 12px; }
  .stat .l { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .stat .n { font-size: 16px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  td, th { padding: 5px 8px; text-align: left; vertical-align: top; }
  td.k { color: var(--muted); width: 42%; }
  td.v, td.num, th.num { }
  .num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.data th { border-bottom: 1px solid var(--line); font-size: 11px; color: var(--muted); }
  table.data td { border-bottom: 1px solid #f0f0f0; }
  ul { margin: 4px 0; padding-left: 18px; }
  .note { color: var(--muted); font-size: 11px; }
  .disclaimer { margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
  @media print { body { padding: 0; } h2 { break-after: avoid; } table, .hero { break-inside: avoid; } }
</style></head>
<body>
  <h1>Your FIRE plan</h1>
  <p class="sub">Financial Independence, Retire Early — generated ${esc(generatedOn)}</p>

  <div class="hero">
    <div class="sub">FIRE number (corpus needed at age ${form.targetAge})</div>
    <div class="num">${fmt(sim.requiredCorpusAtTarget)}</div>
    <div class="note">${esc(FIRE_VARIANT_LABEL[variant])}</div>
    <div class="grid">
      <div class="stat"><div class="l">Target age</div><div class="n">${form.targetAge}</div></div>
      <div class="stat"><div class="l">Years away</div><div class="n">${horizonYears} yrs</div></div>
      <div class="stat"><div class="l">Monthly savings needed</div><div class="n">${fmt(requiredMonthly)}/mo</div></div>
    </div>
  </div>

  <h2>Profile &amp; assumptions</h2>
  <table>
    ${row("Current age", String(form.currentAge))}
    ${row("Household", esc(form.household.replace(/_/g, " ")))}
    ${row("Current location", `${esc(form.city || "—")}, ${esc(form.country || "—")} · ${tierLabel(form.country, form.city, form.homeTierOverride)}`)}
    ${row("Retirement location", form.retirementLocation === "undecided"
      ? "Undecided — using current location's costs"
      : `${esc(form.retirementCity || "—")}, ${esc(form.retirementCountry || "—")} · ${tierLabel(form.retirementCountry, form.retirementCity, form.retirementTierOverride)}`)}
    ${row("Life expectancy (plan horizon)", String(form.userLifeExpectancy))}
    ${row("Risk profile", `${esc(risk.label)} · ${(risk.realReturn * 100).toFixed(1)}% real return`)}
  </table>

  <h2>Financial snapshot</h2>
  <table>
    ${row("Net worth today", fmt(form.currentNetWorth))}
    ${row("Gross annual income", fmt(form.annualIncome))}
    ${row("Annual savings", `${fmt(form.annualSavings)}${form.annualIncome > 0 ? ` (${((form.annualSavings / form.annualIncome) * 100).toFixed(0)}% of income)` : ""}`)}
  </table>

  <h2>Retirement spending — the logic applied</h2>
  <table>
    ${row("Desired monthly spend (today)", fmt(form.monthlySpendRetirement))}
    ${row("Cost-of-living factor", `${loc.factor.toFixed(2)}× — ${esc(basisText)}`)}
    ${crossCurrency ? row("Equivalent in retirement currency", `${formatMoney(form.monthlySpendRetirement * loc.factor, retCurrency)}/mo (${retCurrency})`) : ""}
    ${row("Housing", esc(housingText))}
    ${row("Second-property rental income", form.monthlyRentalIncome > 0 ? `${fmt(form.monthlyRentalIncome)}/mo — treated as real, inflation-proof income` : "None")}
    ${row("Guaranteed income (pension/annuity/rent)", fmt(form.annualGuaranteedIncome + form.monthlyRentalIncome * 12) + "/yr")}
    ${row("Dependant costs", form.retirementSpendIncludesDependants ? "Included in spend, then tapered as dependants become independent" : "Added on top of own spend, tapered over life expectancy")}
  </table>
  <p class="note">The factor scales only your non-rent lifestyle. Rent and ownership costs are
  entered as retirement-location figures and are never scaled. Dependant costs are modelled as
  their own time-varying streams and are excluded from the scaled lifestyle.</p>

  <h2>Dependants</h2>
  <ul>${deps}</ul>

  <h2>The plan</h2>
  <table>
    ${row("Required corpus at target age", fmt(sim.requiredCorpusAtTarget))}
    ${row("Retirement expense at target age", fmt(sim.expenseAtTarget) + "/yr")}
    ${row("Peak retirement expense", fmt(sim.peakRetirementExpense) + "/yr")}
    ${row("Current monthly savings", fmt(sim.currentMonthlySavings) + "/mo")}
    ${row("Required monthly savings", fmt(requiredMonthly) + "/mo")}
    ${row("Savings gap", sim.requiredAdditionalMonthlySavings > 0 ? fmt(sim.requiredAdditionalMonthlySavings) + "/mo more needed" : "On track — no additional saving needed")}
    ${row("Projected FIRE age at current pace", sim.fireAgeAtCurrentSavings != null ? sim.fireAgeAtCurrentSavings.toFixed(1) : "Not reached by life expectancy")}
    ${row("Progress toward corpus", `${Math.round(sim.progress * 100)}%`)}
  </table>

  <h2>Sensitivity</h2>
  <table class="data">
    <thead><tr><th>Scenario</th><th class="num">Real return</th><th class="num">Corpus</th><th class="num">FIRE age</th></tr></thead>
    <tbody>${sensitivityRows}</tbody>
  </table>
  <p class="note">The corpus is sized by depletion to age ${form.userLifeExpectancy} against your
  actual, varying expenses (not a flat 4% rule).</p>

  <p class="disclaimer">This report is informational only and not financial advice. Figures are in
  ${currency} (today's money) and rest on the assumptions listed above. Validate with a qualified
  financial advisor before making decisions.</p>
</body></html>`;
}
