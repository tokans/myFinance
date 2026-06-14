# Sample import data

Demo workbooks for the **Import Excel** wizard. Regenerate with:

```bash
node scripts/build-sample-data.mjs
```

All files use the app's default month window (Nov 2025 – Apr 2026) and dummy
Indian-finance data. Open any of them in **Apple Numbers** and re-export as
`.numbers` to also test the Numbers import path.

| File | Feature exercised |
|------|-------------------|
| `01-networth-basic.xlsx` | Canonical default schema: one sheet per month, `Item \| Value`, `Total` row with a real `SUM` formula. Clean auto-detect, cross-sheet formula pattern, account-type inference across ~15 types, asset/liability split, net-worth trend. |
| `02-cashflow-credit-debit.xlsx` | `Credit` / `Debit` columns with **no** balance column. Header classification + running-balance carry-forward (balance = previous month ± net change), oldest-month-first commit. |
| `03-estate-readiness.xlsx` | `Maturity Date`, `Contact`, and `What To Do` columns. Maturity prefill for FD rows; emergency contact + action detection feeding the Emergencies page. |
| `04-multi-column-assets.xlsx` | Multiple value columns per row (`Savings`, `Fixed Deposit`) → separate accounts with the header appended; `Credit Card` column → separate liability account. |
| `05-needs-wizard.xlsx` | Deliberately non-default layout (non-month sheet name, title/blank rows, header on row 4, no formulas) to drive the manual review wizard. |
| `06-tutorial-complete.xlsx` | One comprehensive file for the full tutorial video: 6 months × ~12 account types (asset/liability split) in the default schema, plus `Maturity Date` / `Contact` / `What To Do` columns. A single import powers the whole app tour (dashboard, goals, FIRE, estate/insurance/health, export). Used by `demo/scenarios/20-full-tutorial.ts`. |

> All data is fictional and for testing/demo only.
