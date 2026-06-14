/**
 * Life-goal template catalogue + sprite-slicing helpers.
 * Pure data, no DB, no React. Mirrors form-manifests/goals.yaml
 * (life_goal_templates) — keep the two in sync.
 *
 * The tiles are sliced from a single composite PNG (see
 * form-manifests/assets/life-goals.prompt.txt for how it's generated):
 *   public/img/life-goals.png — 4 cols × 3 rows, each tile 256×256 px.
 */

export interface LifeGoalsSprite {
  src: string;
  cols: number;
  rows: number;
  /** Native tile edge in source pixels (informational; slicing is %-based). */
  tileSize: number;
}

export const LIFE_GOALS_SPRITE: LifeGoalsSprite = {
  src: "/img/life-goals.png",
  cols: 4,
  rows: 3,
  tileSize: 256,
};

export interface LifeGoalTemplate {
  /** Stable key, persisted as goals.category. */
  value: string;
  label: string;
  /** Row-major index into the sprite grid (0..11). */
  spriteIndex: number;
  /** Sensible starting target; null for the open-ended "Others" tile. */
  defaultTarget: number | null;
  hint: string;
  /** "Others": repeatable, prompts for a custom name before the form opens. */
  custom?: boolean;
}

export const LIFE_GOAL_TEMPLATES: LifeGoalTemplate[] = [
  { value: "higher_studies",     label: "Higher Studies",             spriteIndex: 0,  defaultTarget: 2_500_000,  hint: "Masters / professional degree" },
  { value: "grand_marriage",     label: "Grand Marriage + Honeymoon", spriteIndex: 1,  defaultTarget: 3_000_000,  hint: "Wedding + post-wedding trip" },
  { value: "annual_vacation",    label: "Annual Vacation Abroad",     spriteIndex: 2,  defaultTarget: 1_500_000,  hint: "Multi-year overseas-trip corpus" },
  { value: "luxury_car",         label: "Buy Luxury Car",             spriteIndex: 3,  defaultTarget: 4_000_000,  hint: "Down-payment + on-road cost" },
  { value: "start_business",     label: "Start Business",             spriteIndex: 4,  defaultTarget: 5_000_000,  hint: "Seed capital + 12-month runway" },
  { value: "kids_education",     label: "Kids College Education",     spriteIndex: 5,  defaultTarget: 5_000_000,  hint: "Undergrad fund per child" },
  { value: "parents_medical",    label: "Parents Medical Needs",      spriteIndex: 6,  defaultTarget: 2_000_000,  hint: "Healthcare + caregiving buffer" },
  { value: "build_legacy",       label: "Build Legacy",               spriteIndex: 7,  defaultTarget: 10_000_000, hint: "Long-term endowment / inheritance" },
  { value: "migrate_abroad",     label: "Migrate Abroad",             spriteIndex: 8,  defaultTarget: 3_000_000,  hint: "Visa + relocation + settling-in" },
  { value: "healthy_retirement", label: "Healthy Retirement",         spriteIndex: 9,  defaultTarget: 20_000_000, hint: "Retirement corpus (top-up)" },
  { value: "philanthropy",       label: "Philanthropy",               spriteIndex: 10, defaultTarget: 1_000_000,  hint: "Annual giving corpus" },
  { value: "others",             label: "Others",                     spriteIndex: 11, defaultTarget: null,       hint: "Add a custom goal — repeatable", custom: true },
];

/**
 * The Healthy Retirement template's category key. FIRE planning gates on this
 * specific goal (not just any goal) — the FIRE plan exists to refine its target.
 */
export const HEALTHY_RETIREMENT_CATEGORY = "healthy_retirement";

/** Look up a template by its persisted category key. */
export function lifeGoalByValue(value: string | null | undefined): LifeGoalTemplate | undefined {
  if (!value) return undefined;
  return LIFE_GOAL_TEMPLATES.find((t) => t.value === value);
}

/**
 * Inline style that crops the composite sprite down to a single tile.
 * Percentage-based so the tile scales fluidly with its container while
 * staying pixel-aligned. Apply to a square (aspect-square) element.
 */
export function spriteTileStyle(spriteIndex: number) {
  const { cols, rows, src } = LIFE_GOALS_SPRITE;
  const col = spriteIndex % cols;
  const row = Math.floor(spriteIndex / cols);
  const x = cols > 1 ? (col / (cols - 1)) * 100 : 0;
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  return {
    backgroundImage: `url("${src}")`,
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
    backgroundRepeat: "no-repeat",
  } as const;
}
