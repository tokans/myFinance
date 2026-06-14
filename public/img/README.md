# Image assets

## `life-goals.png` (required by the Goals page life-goal template picker)

A single composite sprite sheet — **1024 × 768 PNG**, a 4-column × 3-row grid
of twelve 256 × 256 life-goal tiles (no gutters). The Goals page slices it via
`spriteTileStyle()` in [`src/domain/lifeGoals.ts`](../../src/domain/lifeGoals.ts).

Generate it once with the Nano Banana (Gemini 2.5 Flash Image) prompt in
[`form-manifests/assets/life-goals.prompt.txt`](../../form-manifests/assets/life-goals.prompt.txt)
and drop the result here as `life-goals.png`.

Tile order is row-major (index 0 = top-left → index 11 = bottom-right) and must
match `LIFE_GOAL_TEMPLATES` in `src/domain/lifeGoals.ts`. Until the file is
present, the picker renders neutral placeholder squares with labels — no crash.

## `account-types.png` (used by the add/edit-account type picker)

A single composite sprite sheet — **1024 × 1280 PNG**, a 4-column × 5-row grid
of 256 × 256 tiles (no gutters): twenty account-type icons. The `AccountForm`
picker slices it via `spriteCellPosition()` in
[`src/lib/accountTypes.ts`](../../src/lib/accountTypes.ts).

Generate it once with the Nano Banana (Gemini 2.5 Flash Image) prompt in
[`form-manifests/assets/account-types.prompt.txt`](../../form-manifests/assets/account-types.prompt.txt)
and drop the result here as `account-types.png`.

Tile order is row-major and must match `ACCOUNT_TYPES` in
`src/lib/accountTypes.ts`. Until the file is present, the picker renders inline
lucide icons with labels — no crash.
