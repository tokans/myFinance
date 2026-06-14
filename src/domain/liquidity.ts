/**
 * Pure liquidity / survivor-access analytics (Feature 6). No DB/React. Tested in
 * liquidity.test.ts.
 */

/** Operation modes a surviving partner can access without fresh paperwork. */
export const SURVIVOR_MODES = ["joint", "either_or_survivor", "former_or_survivor"];

/** Account types treated as immediately liquid for the emergency fund. */
export const LIQUID_TYPES = ["bank_savings", "checking", "cash"];

/** Default emergency-fund target in months of household expenses. */
export const EMERGENCY_FUND_MIN_MONTHS = 6;

export interface LiquidAccount {
  type: string;
  holding_mode?: string | null;
  value: number;
  kind: "asset" | "liability";
}

/** Total value of asset accounts a surviving partner can operate without paperwork. */
export function spouseOperableTotal(accounts: LiquidAccount[]): number {
  return accounts
    .filter((a) => a.kind === "asset" && a.holding_mode != null && SURVIVOR_MODES.includes(a.holding_mode))
    .reduce((s, a) => s + (a.value || 0), 0);
}

/** Total value of liquid asset accounts (savings/checking/cash). */
export function liquidAssetsTotal(accounts: LiquidAccount[]): number {
  return accounts
    .filter((a) => a.kind === "asset" && LIQUID_TYPES.includes(a.type))
    .reduce((s, a) => s + (a.value || 0), 0);
}

/** Recommended emergency fund = monthly expenses × months. */
export function emergencyFundTarget(monthlyExpenses: number, months = EMERGENCY_FUND_MIN_MONTHS): number {
  if (!(monthlyExpenses > 0)) return 0;
  return monthlyExpenses * months;
}

/** How many months of expenses the liquid assets cover; 0 when expenses unknown. */
export function emergencyFundMonths(liquid: number, monthlyExpenses: number): number {
  if (!(monthlyExpenses > 0)) return 0;
  return liquid / monthlyExpenses;
}

/** True when liquid assets cover fewer than `minMonths` of expenses (and expenses are known). */
export function isEmergencyFundLow(
  liquid: number,
  monthlyExpenses: number,
  minMonths = EMERGENCY_FUND_MIN_MONTHS,
): boolean {
  if (!(monthlyExpenses > 0)) return false;
  return emergencyFundMonths(liquid, monthlyExpenses) < minMonths;
}
