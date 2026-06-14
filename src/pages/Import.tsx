import { useState } from "react";
import { Upload, AlertCircle, Check, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { isTauri } from "@/lib/environment";
import { demoSaveName } from "@/lib/demoMode";
import { useSettingsStore } from "@/stores/settings.store";
import { formatMoney, formatMonthLabel } from "@/lib/format";
import { classifyColumnKind, detectWorkbook, readWorkbook } from "@/excel/parse";
import { commitImport, previewImport } from "@/excel/import";
import { colIndexToLetters } from "@/excel/formulas";
import { buildTemplateWorkbook, defaultTemplateFilename } from "@/excel/template";
import type {
  ColumnKind, CrossSheetPattern, SheetPlan, SheetPreview, SheetRaw,
} from "@/excel/types";

// The only spreadsheet formats the import pipeline supports. Drives both the
// native dialog filter and the browser <input accept> fallback.
const IMPORT_EXTENSIONS = ["xlsx", "xls", "numbers", "csv", "tsv"] as const;
const IMPORT_ACCEPT = IMPORT_EXTENSIONS.map((e) => `.${e}`).join(",");

type Stage = "idle" | "review" | "preview" | "done";

interface DoneState {
  accountsCreated: number;
  snapshotsWritten: number;
  zeroFilled: number;
  perSheet: { sheetName: string; month: string; count: number }[];
}

export function ImportPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const dateFormat = useSettingsStore((s) => s.settings.dateFormat);

  const [stage, setStage] = useState<Stage>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetRaw[]>([]);
  const [plans, setPlans] = useState<SheetPlan[]>([]);
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [allClean, setAllClean] = useState(false);
  const [pattern, setPattern] = useState<CrossSheetPattern | null>(null);
  const [previews, setPreviews] = useState<SheetPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);

  const reset = () => {
    setStage("idle");
    setFileName(null);
    setSheets([]);
    setPlans([]);
    setWarnings({});
    setAllClean(false);
    setPattern(null);
    setPreviews([]);
    setError(null);
    setDone(null);
  };

  const loadWorkbook = (name: string, buf: Uint8Array) => {
    setBusy(true);
    setError(null);
    try {
      const raw = readWorkbook(buf);
      const detection = detectWorkbook(raw, dateFormat);
      setFileName(name);
      setSheets(raw);
      setPlans(detection.plans);
      setWarnings(detection.warnings);
      setAllClean(detection.allMatchDefault);
      setPattern(detection.pattern);
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    loadWorkbook(file.name, new Uint8Array(await file.arrayBuffer()));
  };

  const handleFilePick: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (f) void onFile(f);
  };

  /**
   * Desktop/mobile: use the native open dialog so the OS file picker shows a
   * single "Spreadsheets" filter limited to the formats we accept (no internet
   * shortcuts, executables, etc.). Tauri's dialog plugin auto-grants fs read
   * access to the picked file, so we can read it straight back via the fs plugin.
   * In the browser preview (`npm run dev`) there is no Tauri, so the hidden
   * <input type="file"> fallback handles selection instead.
   */
  const handleChooseFile = async () => {
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Spreadsheets", extensions: [...IMPORT_EXTENSIONS] }],
      });
      if (typeof selected !== "string") return; // cancelled
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const buf = await readFile(selected);
      const name = selected.split(/[\\/]/).pop() ?? selected;
      loadWorkbook(name, buf);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const updatePlan = (idx: number, patch: Partial<SheetPlan>) => {
    setPlans((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const applyPatternToAll = () => {
    if (!pattern) return;
    setPlans((prev) => prev.map((p) => {
      const sheet = sheets.find((s) => s.name === p.sheetName);
      const headerRow = pattern.dataStartRow > 0 ? pattern.dataStartRow - 1 : -1;
      const headerCells = sheet && headerRow >= 0 ? sheet.rows[headerRow] ?? [] : [];
      const valueColHeaders = pattern.valueCols.map((c) => {
        const v = headerCells[c];
        return v == null ? "" : String(v).trim();
      });
      const valueKinds: ColumnKind[] = valueColHeaders.map((h) => classifyColumnKind(h) ?? "unselected");
      return {
        ...p,
        headerRow,
        itemCol: Math.max(0, Math.min(...pattern.valueCols) - 1),
        valueCols: pattern.valueCols,
        valueColHeaders,
        valueKinds,
        dataEndRow: pattern.dataEndRow,
        stopOnTotal: true,
      };
    }));
  };

  /**
   * Apply one column's role across every sheet. When the source column has a
   * header name, match the same-named column in each sheet (their order may
   * differ); otherwise fall back to the same column index.
   */
  const applyColumnRoleToAll = (col: number, role: ColumnRole, headerName?: string) => {
    setPlans((prev) => prev.map((p) => {
      const sheet = sheets.find((s) => s.name === p.sheetName);
      if (!sheet) return p;
      const targetCol = headerName
        ? findColumnByHeader(sheet, p, headerName) ?? col
        : col;
      return { ...p, ...setColumnRole(p, sheet, targetCol, role) };
    }));
  };

  const goPreview = async () => {
    if (!isTauri()) {
      setError("Preview/commit needs the desktop app (SQLite is unavailable in browser mode).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await previewImport(sheets, plans);
      setPreviews(result);
      setStage("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadTemplate = async () => {
    const data = buildTemplateWorkbook();
    try {
      if (isTauri()) {
        const { writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
        const demoName = demoSaveName(defaultTemplateFilename());
        if (demoName) {
          await writeFile(demoName, data, { baseDir: BaseDirectory.AppData });
        } else {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const path = await save({
            defaultPath: defaultTemplateFilename(),
            filters: [{ name: "Excel", extensions: ["xlsx"] }],
          });
          if (path) await writeFile(path, data);
        }
      } else {
        const blob = new Blob([data.buffer as ArrayBuffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultTemplateFilename();
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCommit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await commitImport(previews, { defaultCurrency: currency });
      setDone(r);
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container max-w-4xl py-6">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Import Excel</h2>
        <p className="text-sm text-muted-foreground">
          Multi-sheet workbook. Sheet name = month, column A = item, column B = value.
          The wizard auto-detects this and only asks questions when needed.
        </p>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Parsing works in the browser, but committing to the database needs the desktop app
            (<code className="rounded bg-amber-200/40 px-1">npm run tauri:dev</code>).
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {stage === "idle" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Pick a spreadsheet</p>
              <p className="text-xs text-muted-foreground">
                Excel (.xlsx / .xls), Apple Numbers (.numbers), or CSV. Drag-and-drop coming soon.
              </p>
            </div>
            {isTauri() ? (
              // Desktop/mobile: trigger the native picker (clean, filtered dialog).
              <Button
                type="button"
                data-testid="import-dropzone"
                onClick={handleChooseFile}
                disabled={busy}
              >
                {busy ? "Reading…" : "Choose file"}
              </Button>
            ) : (
              // Browser preview: no Tauri dialog, so the hidden <input> drives it.
              <Label
                htmlFor="xlsx"
                data-testid="import-dropzone"
                className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {busy ? "Reading…" : "Choose file"}
              </Label>
            )}
            {/*
              Always present in the DOM: the browser fallback triggers it via the
              <Label>, and the WebDriver demo harness sets its value directly. In
              the real Tauri app it stays hidden behind the native dialog above.
            */}
            <input
              id="xlsx"
              data-testid="import-file-input"
              type="file"
              className="hidden"
              accept={IMPORT_ACCEPT}
              onChange={handleFilePick}
              disabled={busy}
            />
            <div className="pt-2 text-xs text-muted-foreground">
              Not sure of the layout?{" "}
              <button onClick={handleDownloadTemplate} className="underline hover:text-foreground">
                Download an example template
              </button>{" "}
              to paste your data into.
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "review" && (
        <ReviewStage
          fileName={fileName ?? "(file)"}
          sheets={sheets}
          plans={plans}
          warnings={warnings}
          allClean={allClean}
          pattern={pattern}
          onApplyPattern={applyPatternToAll}
          onPlanChange={updatePlan}
          onApplyColumnRoleToAll={applyColumnRoleToAll}
          onBack={reset}
          onNext={goPreview}
          busy={busy}
        />
      )}

      {stage === "preview" && (
        <PreviewStage
          previews={previews}
          currency={currency}
          onBack={() => setStage("review")}
          onCommit={handleCommit}
          busy={busy}
        />
      )}

      {stage === "done" && done && (
        <DoneStage result={done} onReset={reset} onDownloadTemplate={handleDownloadTemplate} />
      )}
    </div>
  );
}

function ReviewStage({
  fileName, sheets, plans, warnings, allClean, pattern, onApplyPattern, onPlanChange, onApplyColumnRoleToAll, onBack, onNext, busy,
}: {
  fileName: string;
  sheets: SheetRaw[];
  plans: SheetPlan[];
  warnings: Record<string, string>;
  allClean: boolean;
  pattern: CrossSheetPattern | null;
  onApplyPattern: () => void;
  onPlanChange: (i: number, patch: Partial<SheetPlan>) => void;
  onApplyColumnRoleToAll: (col: number, role: ColumnRole, headerName?: string) => void;
  onBack: () => void;
  onNext: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center gap-3 py-3 text-sm">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{fileName}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{plans.length} sheet{plans.length === 1 ? "" : "s"}</span>
          {allClean ? (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
              <Check className="h-3 w-3" /> Default schema detected
            </span>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <AlertCircle className="h-3 w-3" /> Needs review
            </span>
          )}
        </CardContent>
      </Card>

      {pattern && (
        <Card className="border-sky-300/60 bg-sky-50/40 dark:bg-sky-950/20">
          <CardContent className="space-y-2 py-4">
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-sky-700 dark:text-sky-300" />
              <span className="font-medium text-sky-900 dark:text-sky-100">
                Detected pattern from formulas in {pattern.matchingSheets.length} of {pattern.totalSheets} sheet{pattern.totalSheets === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-xs text-sky-900/80 dark:text-sky-200/80">
              Data rows {pattern.dataStartRow + 1}–{pattern.dataEndRow + 1},
              {" "}value column{pattern.valueCols.length === 1 ? "" : "s"} {pattern.valueCols.map(colIndexToLetters).join(", ")},
              {" "}totals in row {pattern.totalRow + 1}.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={onApplyPattern} disabled={busy}>
                Apply to all sheets
              </Button>
              <span className="text-xs text-sky-800/70 dark:text-sky-300/70">
                Or review each sheet individually below.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <ul className="space-y-2">
        {plans.map((p, i) => (
          <li key={p.sheetName}>
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <input
                    id={`inc-${i}`}
                    data-testid={`review-include-${i}`}
                    type="checkbox"
                    checked={p.include}
                    onChange={(e) => onPlanChange(i, { include: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <Label htmlFor={`inc-${i}`} className="font-medium">{p.sheetName}</Label>
                  {warnings[p.sheetName] && (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                      <AlertCircle className="h-3 w-3" /> {warnings[p.sheetName]}
                    </span>
                  )}
                </div>

                {p.include && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`m-${i}`} className="text-xs">Month</Label>
                      <Input
                        id={`m-${i}`}
                        data-testid={`review-month-${i}`}
                        type="month"
                        value={p.month}
                        onChange={(e) => onPlanChange(i, { month: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`h-${i}`} className="text-xs">Header row (1-based, 0 = none)</Label>
                      <Input
                        id={`h-${i}`}
                        data-testid={`review-headerrow-${i}`}
                        type="number"
                        min={0}
                        value={p.headerRow + 1}
                        onChange={(e) => onPlanChange(i, { headerRow: Number(e.target.value) - 1 })}
                      />
                    </div>
                  </div>
                )}

                {p.include && (
                  <ColumnRoleControls
                    idx={i}
                    plan={p}
                    sheet={sheets.find((s) => s.name === p.sheetName)}
                    multiSheet={plans.length > 1}
                    onChange={(patch) => onPlanChange(i, patch)}
                    onApplyToAll={onApplyColumnRoleToAll}
                  />
                )}

                {p.include && p.valueCols.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Rows with values in multiple columns will be imported as separate items, with the
                    column header appended (e.g. "HDFC – {p.valueColHeaders[1] || "col 2"}").
                  </p>
                )}

                {p.include && (
                  <div className="flex items-center gap-2">
                    <input
                      id={`tot-${i}`}
                      type="checkbox"
                      checked={p.stopOnTotal}
                      onChange={(e) => onPlanChange(i, { stopOnTotal: e.target.checked })}
                      className="h-4 w-4"
                    />
                    <Label htmlFor={`tot-${i}`} className="text-xs text-muted-foreground">
                      Stop at a row labeled "Total"
                    </Label>
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={busy}>Cancel</Button>
        <Button data-testid="import-preview-button" onClick={onNext} disabled={busy}>
          {busy ? "Building preview…" : "Preview rows"}
        </Button>
      </div>
    </div>
  );
}

/**
 * A column's role in the mapping. "account" = item/name column; "what_to_do" =
 * the free-text emergency-action column (stored on each account, not a snapshot);
 * "unselected"/"ignore" don't import.
 */
type ColumnRole = "account" | "what_to_do" | ColumnKind;

const ROLE_LABEL: Record<ColumnRole, string> = {
  unselected: "— Select —",
  account: "Account name",
  balance: "Balance (absolute)",
  credit: "Credit (add to previous month)",
  debit: "Debit (subtract from previous month)",
  credit_card: "Credit card (separate account)",
  what_to_do: "What to do (emergency action)",
  ignore: "Ignore",
};

/** Roles that actually produce snapshots (i.e. a column the user has meaningfully assigned a value to). */
function isValueRole(role: ColumnRole): boolean {
  return role === "balance" || role === "credit" || role === "debit" || role === "credit_card";
}

/** Header text for a column, or "" when there's no header row. */
function columnHeader(sheet: SheetRaw, plan: SheetPlan, col: number): string {
  if (plan.headerRow < 0) return "";
  const cell = sheet.rows[plan.headerRow]?.[col];
  return cell == null ? "" : String(cell).trim();
}

/** Find the column whose header matches `name` (case-insensitive), or null if absent. */
function findColumnByHeader(sheet: SheetRaw, plan: SheetPlan, name: string): number | null {
  if (plan.headerRow < 0) return null;
  const target = name.trim().toLowerCase();
  if (!target) return null;
  const row = sheet.rows[plan.headerRow];
  if (!row) return null;
  for (let c = 0; c < row.length; c++) {
    const v = row[c];
    if (v != null && String(v).trim().toLowerCase() === target) return c;
  }
  return null;
}

/** Columns worth showing: those with content in the header/first data row, plus the mapped ones. */
function sheetColumns(sheet: SheetRaw, plan: SheetPlan): number[] {
  const set = new Set<number>();
  const addRow = (row: (string | number | null)[] | undefined) => {
    if (!row) return;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v != null && String(v).trim() !== "") set.add(c);
    }
  };
  if (plan.headerRow >= 0) addRow(sheet.rows[plan.headerRow]);
  addRow(sheet.rows[plan.headerRow === -1 ? 0 : plan.headerRow + 1]);
  if (plan.itemCol >= 0) set.add(plan.itemCol);
  plan.valueCols.forEach((c) => set.add(c));
  if (plan.emergencyActionCol != null && plan.emergencyActionCol >= 0) set.add(plan.emergencyActionCol);
  if (set.size === 0) set.add(0);
  return [...set].sort((a, b) => a - b);
}

function roleOf(plan: SheetPlan, col: number): ColumnRole {
  if (col === plan.itemCol) return "account";
  if (col === plan.emergencyActionCol) return "what_to_do";
  const idx = plan.valueCols.indexOf(col);
  if (idx >= 0) return plan.valueKinds?.[idx] ?? "unselected";
  return "unselected";
}

/** Build the plan patch for setting `col`'s role, keeping itemCol/valueCols/headers consistent. */
function setColumnRole(plan: SheetPlan, sheet: SheetRaw, col: number, role: ColumnRole): Partial<SheetPlan> {
  let itemCol = plan.itemCol;
  // Drop `col` from the value columns; releasing the account column too if it was this one.
  const pairs = plan.valueCols
    .map((c, idx) => ({ col: c, kind: plan.valueKinds?.[idx] ?? ("unselected" as ColumnKind) }))
    .filter((p) => p.col !== col);
  if (itemCol === col) itemCol = -1;

  // The emergency-action column lives outside valueCols. Release `col` from it
  // if it held that role; claim it below when "what_to_do" is chosen. Only one
  // column can be the what-to-do column, so assigning a new one replaces the old.
  let emergencyActionCol = plan.emergencyActionCol;
  if (emergencyActionCol === col) emergencyActionCol = undefined;

  if (role === "account") {
    itemCol = col; // a single account column — the previous one falls back to "unselected"
  } else if (role === "what_to_do") {
    emergencyActionCol = col;
  } else if (
    role === "balance" || role === "credit" || role === "debit" ||
    role === "credit_card" || role === "ignore"
  ) {
    pairs.push({ col, kind: role });
  }
  // role === "unselected" → leave `col` out of valueCols entirely.
  pairs.sort((a, b) => a.col - b.col);

  return {
    itemCol,
    valueCols: pairs.map((p) => p.col),
    valueKinds: pairs.map((p) => p.kind),
    valueColHeaders: pairs.map((p) => columnHeader(sheet, plan, p.col)),
    emergencyActionCol,
  };
}

/**
 * Per-column role picker. Every column in the sheet gets a "How to read"
 * dropdown — Select / Account name / Balance / Credit / Debit / Ignore. The
 * first column defaults to Account name; value columns start unselected (we
 * never guess Balance) and "Apply to all sheets" propagates a choice across
 * every sheet. Anything left unselected is ignored at import.
 */
function ColumnRoleControls({
  idx, plan, sheet, multiSheet, onChange, onApplyToAll,
}: {
  idx: number;
  plan: SheetPlan;
  sheet: SheetRaw | undefined;
  multiSheet: boolean;
  onChange: (patch: Partial<SheetPlan>) => void;
  onApplyToAll: (col: number, role: ColumnRole, headerName?: string) => void;
}) {
  if (!sheet) return null;
  const cols = sheetColumns(sheet, plan);
  const hasAccount = cols.some((c) => roleOf(plan, c) === "account");
  const hasValue = cols.some((c) => isValueRole(roleOf(plan, c)));

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <p className="text-xs font-medium">How to read each column</p>
      {cols.map((col) => {
        const header = columnHeader(sheet, plan, col);
        const role = roleOf(plan, col);
        return (
          <div key={col} className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <Label className="truncate text-xs">
                Column {colIndexToLetters(col)}
                {header && <span className="text-muted-foreground"> · “{header}”</span>}
              </Label>
              {multiSheet && role !== "unselected" && (
                <button
                  type="button"
                  onClick={() => onApplyToAll(col, role, header)}
                  className="block text-[11px] text-primary underline-offset-2 hover:underline"
                >
                  Apply “{ROLE_LABEL[role]}” to all sheets
                  {header ? ` (by column “${header}”)` : ""}
                </button>
              )}
            </div>
            <Select value={role} onValueChange={(v) => onChange(setColumnRole(plan, sheet, col, v as ColumnRole))}>
              <SelectTrigger data-testid={`col-role-trigger-${idx}-${col}`} className="h-9 w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem data-testid="col-role-item-unselected" value="unselected">{ROLE_LABEL.unselected}</SelectItem>
                <SelectItem data-testid="col-role-item-account" value="account">{ROLE_LABEL.account}</SelectItem>
                <SelectItem data-testid="col-role-item-balance" value="balance">{ROLE_LABEL.balance}</SelectItem>
                <SelectItem data-testid="col-role-item-credit" value="credit">{ROLE_LABEL.credit}</SelectItem>
                <SelectItem data-testid="col-role-item-debit" value="debit">{ROLE_LABEL.debit}</SelectItem>
                <SelectItem data-testid="col-role-item-credit_card" value="credit_card">{ROLE_LABEL.credit_card}</SelectItem>
                <SelectItem data-testid="col-role-item-what_to_do" value="what_to_do">{ROLE_LABEL.what_to_do}</SelectItem>
                <SelectItem data-testid="col-role-item-ignore" value="ignore">{ROLE_LABEL.ignore}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      })}
      {!hasAccount && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          No column is set to <span className="font-medium">Account name</span> — pick one or no rows will import.
        </p>
      )}
      {!hasValue && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          No value column selected — choose <span className="font-medium">Balance/Credit/Debit</span> or nothing imports for this sheet.
        </p>
      )}
    </div>
  );
}

function PreviewStage({
  previews, currency, onBack, onCommit, busy,
}: {
  previews: SheetPreview[];
  currency: string;
  onBack: () => void;
  onCommit: () => void;
  busy: boolean;
}) {
  const totalRows = previews.reduce((acc, p) => acc + p.rows.length, 0);
  const newAccounts = previews.reduce(
    (acc, p) => acc + p.rows.filter((r) => r.matchedAccountId == null).length,
    0,
  );
  const emergencyRows = previews.reduce(
    (acc, p) => acc + p.rows.filter((r) => r.emergencyAction || r.contact).length,
    0,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span><strong>{previews.length}</strong> sheet{previews.length === 1 ? "" : "s"}</span>
            <span><strong>{totalRows}</strong> row{totalRows === 1 ? "" : "s"}</span>
            <span>
              <strong>{newAccounts}</strong> new account{newAccounts === 1 ? "" : "s"} will be created
            </span>
            {emergencyRows > 0 && (
              <span>
                <strong>{emergencyRows}</strong> row{emergencyRows === 1 ? "" : "s"} with emergency info detected
              </span>
            )}
          </div>
          {emergencyRows > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Detected "contact" / "what to do" / "emergency" columns. This text fills each account's
              emergency action &amp; contact (only when those are currently empty). Review it on the
              <strong> Emergencies</strong> page — it is stored as-is and never verified.
            </p>
          )}
        </CardContent>
      </Card>

      {previews.map((p) => (
        <Card key={p.sheetName + p.month}>
          <CardContent className="p-0">
            <div className="border-b px-4 py-2 text-sm">
              <span className="font-medium">{p.sheetName}</span>
              <span className="text-muted-foreground"> → {formatMonthLabel(p.month)}</span>
              {p.rows.some((r) => r.kind !== "balance") && (
                <p className="text-xs text-muted-foreground">
                  Credit/debit rows show the monthly change; the stored balance = previous month ± this amount.
                </p>
              )}
            </div>
            {p.errors.length > 0 && (
              <div className="border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
                {p.errors.join(", ")}
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Item</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                  <th className="px-4 py-2 text-left font-medium">Account</th>
                </tr>
              </thead>
              <tbody>
                {p.rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-4 py-1.5">
                      {r.item}
                      {(r.emergencyAction || r.contact) && (
                        <span
                          title={[r.emergencyAction, r.contact].filter(Boolean).join(" · ")}
                          className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        >
                          <Check className="h-2.5 w-2.5" /> emergency info
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {r.kind !== "balance" && (
                          <span
                            className={
                              r.kind === "credit"
                                ? "rounded bg-emerald-100 px-1 text-[10px] uppercase text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : "rounded bg-rose-100 px-1 text-[10px] uppercase text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                            }
                          >
                            {r.kind === "credit" ? "+ credit" : "− debit"}
                          </span>
                        )}
                        {formatMoney(r.value, currency)}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-xs">
                      {r.matchedAccountId == null ? (
                        <span className="text-emerald-700 dark:text-emerald-400">+ new</span>
                      ) : (
                        <span className="text-muted-foreground">matched</span>
                      )}
                    </td>
                  </tr>
                ))}
                {p.rows.length > 50 && (
                  <tr className="border-t">
                    <td colSpan={3} className="px-4 py-1.5 text-xs text-muted-foreground">
                      … {p.rows.length - 50} more
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={busy}>Back</Button>
        <Button data-testid="import-commit-button" onClick={onCommit} disabled={busy || totalRows === 0}>
          {busy ? "Importing…" : "Commit import"}
        </Button>
      </div>
    </div>
  );
}

function DoneStage({
  result, onReset, onDownloadTemplate,
}: {
  result: DoneState;
  onReset: () => void;
  onDownloadTemplate: () => void;
}) {
  const failed = result.snapshotsWritten === 0;
  return (
    <Card className={failed ? "border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20" : undefined}>
      <CardContent className="space-y-3 py-6">
        <div className="flex items-center gap-2">
          {failed ? (
            <>
              <AlertCircle className="h-5 w-5 text-amber-700 dark:text-amber-400" />
              <h3 className="text-base font-semibold">No rows imported</h3>
            </>
          ) : (
            <>
              <div className="rounded-full bg-emerald-100 p-1 dark:bg-emerald-950">
                <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              </div>
              <h3 data-testid="import-done" className="text-base font-semibold">Import complete</h3>
            </>
          )}
        </div>

        {failed ? (
          <div className="space-y-3 text-sm">
            <p className="text-amber-900 dark:text-amber-100">
              The wizard couldn&apos;t extract any (item, value) pairs from this file.
              The fastest fix is to download the template, paste your data into it, and re-upload.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={onDownloadTemplate}>Download template</Button>
              <Button size="sm" variant="ghost" onClick={onReset}>Pick another file</Button>
            </div>
          </div>
        ) : (
          <>
            <ul className="text-sm text-muted-foreground">
              <li>{result.snapshotsWritten} monthly snapshot(s) written</li>
              <li>{result.accountsCreated} new account(s) created</li>
              {result.zeroFilled > 0 && (
                <li>{result.zeroFilled} account(s) zeroed out for months they were missing from</li>
              )}
            </ul>
            <ul className="border-t pt-2 text-xs">
              {result.perSheet.map((p) => (
                <li key={p.sheetName + p.month} className="flex justify-between py-0.5">
                  <span>{p.sheetName} → {formatMonthLabel(p.month)}</span>
                  <span className="text-muted-foreground">{p.count} row{p.count === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
            <div className="pt-2">
              <Button variant="outline" size="sm" onClick={onReset}>Import another file</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
