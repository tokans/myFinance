/**
 * Pure insurance adequacy calculators (Feature 5). No DB/React. Deterministic —
 * no LLM. Tested in insurance.test.ts.
 */

export type PolicyKind =
  | "term" | "health" | "accident" | "critical_illness"
  | "loan" | "endowment" | "ulip" | "motor" | "home" | "other";

export const POLICY_KINDS: { value: PolicyKind; label: string }[] = [
  { value: "term", label: "Term life" },
  { value: "health", label: "Health" },
  { value: "accident", label: "Personal accident" },
  { value: "critical_illness", label: "Critical illness" },
  { value: "loan", label: "Loan protection" },
  { value: "endowment", label: "Endowment" },
  { value: "ulip", label: "ULIP" },
  { value: "motor", label: "Motor" },
  { value: "home", label: "Home" },
  { value: "other", label: "Other" },
];

export function policyKindLabel(kind: string): string {
  return POLICY_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export interface PolicyLike {
  kind: PolicyKind | string;
  sum_assured: number;
}

/** Recommended term-life cover: a multiple of annual income (default 12×, in the 10–15× band). */
export function recommendedTermCover(annualIncome: number, multiplier = 12): number {
  if (!(annualIncome > 0)) return 0;
  return annualIncome * multiplier;
}

/** Shortfall between a target and what's covered; never negative. */
export function coverageGap(target: number, covered: number): number {
  return Math.max(0, target - covered);
}

/** Total sum assured across policies of a given kind. */
export function coveredFor(policies: PolicyLike[], kind: PolicyKind): number {
  return policies
    .filter((p) => p.kind === kind)
    .reduce((s, p) => s + (Number(p.sum_assured) || 0), 0);
}

export interface AdequacyInputs {
  annualIncome: number;
  termMultiplier?: number;
  /** Target health floater cover (e.g. typical metro hospitalisation need). */
  healthTarget?: number;
  /** Target personal-accident cover. */
  accidentTarget?: number;
  /** Target critical-illness lump sum. */
  criticalIllnessTarget?: number;
  /** Outstanding loans that should be covered by loan protection. */
  outstandingLoans?: number;
}

export interface CoverageLine {
  kind: PolicyKind;
  label: string;
  target: number;
  covered: number;
  gap: number;
  adequate: boolean;
}

/** Build per-kind coverage lines comparing target vs covered. Only kinds with a target are returned. */
export function assessCoverage(policies: PolicyLike[], inputs: AdequacyInputs): CoverageLine[] {
  const targets: { kind: PolicyKind; target: number }[] = [
    { kind: "term", target: recommendedTermCover(inputs.annualIncome, inputs.termMultiplier) },
    { kind: "health", target: inputs.healthTarget ?? 0 },
    { kind: "accident", target: inputs.accidentTarget ?? 0 },
    { kind: "critical_illness", target: inputs.criticalIllnessTarget ?? 0 },
    { kind: "loan", target: inputs.outstandingLoans ?? 0 },
  ];
  return targets
    .filter((t) => t.target > 0)
    .map(({ kind, target }) => {
      const covered = coveredFor(policies, kind);
      const gap = coverageGap(target, covered);
      return { kind, label: policyKindLabel(kind), target, covered, gap, adequate: gap === 0 };
    });
}
