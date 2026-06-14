/**
 * Pure annual-review + life-event playbooks (Feature 10). No DB/React. Tested in
 * review.test.ts.
 */
export { fyReviewDueDate } from "./reminders";

export type LifeEventType =
  | "marriage" | "childbirth" | "property_purchase" | "job_change"
  | "new_loan" | "relocation" | "bereavement";

export const LIFE_EVENT_TYPES: { value: LifeEventType; label: string }[] = [
  { value: "marriage", label: "Marriage" },
  { value: "childbirth", label: "Childbirth" },
  { value: "property_purchase", label: "Property purchase" },
  { value: "job_change", label: "Job change" },
  { value: "new_loan", label: "New loan" },
  { value: "relocation", label: "Relocation" },
  { value: "bereavement", label: "Bereavement / parent's death" },
];

export function lifeEventLabel(type: string): string {
  return LIFE_EVENT_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** The standing annual review covering every estate-readiness surface. */
export function annualReviewChecklist(): string[] {
  return [
    "Refresh the asset register and account values",
    "Verify nominees on every account (and shares total 100%)",
    "Re-read your Will; reconcile beneficiaries vs nominees",
    "Re-run the insurance coverage gap analysis",
    "Rotate vault credentials and recovery codes",
    "Confirm emergency contacts and the ICE card are current",
  ];
}

const COMMON_TAIL = ["Update the asset register", "Re-check the Will and nominees"];

/** A tailored checklist for a specific life event, with relevant feature touchpoints. */
export function reviewChecklistFor(type: LifeEventType): string[] {
  switch (type) {
    case "marriage":
      return ["Add spouse to People", "Update nominees and Will beneficiaries", "Review joint/either-or-survivor account modes", "Revisit term-life and health cover", ...COMMON_TAIL];
    case "childbirth":
      return ["Add child to People", "Appoint/confirm a guardian for minors in the Will", "Add the child as nominee/beneficiary where appropriate", "Increase term-life cover", ...COMMON_TAIL];
    case "property_purchase":
      return ["Add the property to the register", "Record co-holders and holding mode", "Check home insurance and loan protection", "Note probate-jurisdiction if applicable", ...COMMON_TAIL];
    case "job_change":
      return ["Update EPF/NPS and employer insurance", "Re-check income for term-cover adequacy", "Move/roll over old retirement accounts", ...COMMON_TAIL];
    case "new_loan":
      return ["Add the loan as a liability", "Record co-borrower", "Add loan-protection insurance", "Re-check emergency-fund liquidity", ...COMMON_TAIL];
    case "relocation":
      return ["Update address and residence settings", "Re-check probate jurisdiction", "Update bank/RM contacts", ...COMMON_TAIL];
    case "bereavement":
      return ["Update People and nominees", "Reconcile inherited assets into the register", "Revisit your own Will and executor", ...COMMON_TAIL];
  }
}
