import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Archive, ArchiveRestore, CalendarCheck, Trash2, GitMerge, X, Wand2, Upload, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountForm } from "@/components/accounts/AccountForm";
import { SipChip } from "@/components/accounts/SipChip";
import { isTauri } from "@/lib/environment";
import { currentMonth, formatMoney } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import {
  archiveAccount,
  clearAllAccounts,
  countAccounts,
  createAccount,
  listAccounts,
  mergeAccounts,
  setAccountInstitution,
  setAccountType,
  updateAccount,
  type Account,
  type AccountInput,
} from "@/db/accounts";
import { clearAllSnapshots, countSnapshots } from "@/db/snapshots";
import { ACCOUNT_TYPES, accountTypeKind, accountTypeLabel, type AccountType } from "@/lib/accountTypes";
import { inferAccountTypeForName, inferInstitution } from "@/lib/institutions";
import { useGatingStore } from "@/stores/gating.store";

/**
 * A single proposed auto-detect change. The bulk "Auto-type" tool re-derives an
 * account's type *and* institution from its name. A row is shown when the type
 * would change or an institution can be filled in; the user can adjust either
 * before applying. `institutionProposed` records that a suggestion was offered
 * (only when the account had no institution), so the inline input still renders
 * after the user clears the suggested value to skip it.
 */
interface AutoFixRow {
  id: number;
  name: string;
  typeFrom: AccountType;
  type: AccountType;
  institutionProposed: boolean;
  institution: string;
}

export function AccountsPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const refreshGating = useGatingStore((s) => s.refresh);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [adding, setAdding] = useState(false);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [accountCount, setAccountCount] = useState(0);
  const [confirming, setConfirming] = useState<"data" | "accounts" | null>(null);
  const [clearing, setClearing] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [merging, setMerging] = useState(false);
  const [autoTypePreview, setAutoTypePreview] = useState<AutoFixRow[] | null>(null);
  const [autoTyping, setAutoTyping] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountType | "all">("all");
  const [institutionFilter, setInstitutionFilter] = useState("all");

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [rows, snaps, accts] = await Promise.all([
        listAccounts({ includeArchived: showArchived }),
        countSnapshots(),
        countAccounts(),
      ]);
      setAccounts(rows);
      setSnapshotCount(snaps);
      setAccountCount(accts);
      // Account count and emergency-action presence gate Tax / Emergency Planning.
      void refreshGating();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showArchived, refreshGating]);

  useEffect(() => { void refresh(); }, [refresh]);

  const runClear = async (fn: () => Promise<void>) => {
    setClearing(true);
    setError(null);
    try {
      await fn();
      setConfirming(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
    }
  };

  const handleCreate = async (input: AccountInput) => {
    await createAccount(input);
    setAdding(false);
    await refresh();
  };

  const handleUpdate = async (input: AccountInput) => {
    if (!editing) return;
    await updateAccount(editing.id, input);
    setEditing(null);
    await refresh();
  };

  const handleArchive = async (acc: Account) => {
    await archiveAccount(acc.id, acc.is_archived === 0);
    await refresh();
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds([]);
    setMerging(false);
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));

  const handleMerge = async (survivorId: number) => {
    // Pass each account's kind so a mixed asset/liability merge negates the
    // cross-kind values (a folded-in loan stays a subtraction in net worth).
    const kinds = new Map(selectedAccounts.map((a) => [a.id, accountTypeKind(a.type)]));
    await mergeAccounts(survivorId, selectedIds, kinds);
    exitSelectMode();
    await refresh();
  };

  // Propose type and institution fills for every account whose name implies a
  // better type or a (currently missing) institution. Mirrors the add/edit
  // form's auto-detect: type via inferAccountTypeForName (which also leans on
  // the matched institution), institution via inferInstitution — but only filled
  // when the account has none, so a user-typed institution is never clobbered.
  const previewAutoType = async () => {
    setError(null);
    try {
      const all = await listAccounts({ includeArchived: true });
      const changes = all
        .map((a): AutoFixRow => {
          const hasInstitution = !!a.institution?.trim();
          const inferredInstitution = hasInstitution ? null : inferInstitution(a.name);
          return {
            id: a.id,
            name: a.name,
            typeFrom: a.type,
            type: inferAccountTypeForName(a.name) ?? a.type,
            institutionProposed: inferredInstitution != null,
            institution: inferredInstitution ?? "",
          };
        })
        .filter((c) => c.type !== c.typeFrom || c.institutionProposed);
      setAutoTypePreview(changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setAutoTypeRow = (id: number, patch: Partial<Pick<AutoFixRow, "type" | "institution">>) => {
    setAutoTypePreview((prev) => prev && prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  // A row writes something when its type differs from the original or it carries
  // a non-blank institution to fill in.
  const autoFixCount = (rows: AutoFixRow[]) =>
    rows.filter((c) => c.type !== c.typeFrom || c.institution.trim() !== "").length;

  const applyAutoType = async () => {
    if (!autoTypePreview) return;
    setAutoTyping(true);
    setError(null);
    try {
      for (const c of autoTypePreview) {
        // Skip rows the user dialed back to their current type — nothing to write.
        if (c.type !== c.typeFrom) await setAccountType(c.id, c.type);
        const institution = c.institution.trim();
        if (institution) await setAccountInstitution(c.id, institution);
      }
      setAutoTypePreview(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoTyping(false);
    }
  };

  // Distinct institutions present across the loaded accounts, for the filter
  // dropdown. Trimmed + de-duped; accounts without one are excluded.
  const institutions = useMemo(
    () =>
      Array.from(
        new Set(accounts.map((a) => a.institution?.trim()).filter((s): s is string => !!s)),
      ).sort((a, b) => a.localeCompare(b)),
    [accounts],
  );

  // Only offer type-filter options that actually occur, so the dropdown stays
  // short and never lists a type with zero matches.
  const typesPresent = useMemo(
    () => ACCOUNT_TYPES.filter((t) => accounts.some((a) => a.type === t.value)),
    [accounts],
  );

  const filtersActive = query.trim() !== "" || typeFilter !== "all" || institutionFilter !== "all";

  // Free-text query matches name OR institution; the two dropdowns narrow by
  // exact type / institution. All applied client-side over the already-loaded
  // rows — no extra DB round-trip.
  const visibleAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => {
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      if (institutionFilter !== "all" && (a.institution?.trim() ?? "") !== institutionFilter) return false;
      if (q && !`${a.name} ${a.institution ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [accounts, query, typeFilter, institutionFilter]);

  const clearFilters = () => {
    setQuery("");
    setTypeFilter("all");
    setInstitutionFilter("all");
  };

  return (
    <div className="container max-w-4xl py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Accounts</h2>
          <p className="text-sm text-muted-foreground">Bank accounts, cards, investments, loans.</p>
        </div>
        <div className="flex gap-2">
          {selectMode ? (
            <Button variant="ghost" onClick={exitSelectMode}>
              <X className="h-4 w-4" /> Cancel
            </Button>
          ) : (
            <>
              {accounts.length > 1 && (
                <Button variant="outline" onClick={() => { setSelectMode(true); setEditing(null); setAdding(false); }} disabled={!isTauri()}>
                  <GitMerge className="h-4 w-4" /> Merge
                </Button>
              )}
              {accounts.length > 0 && (
                <Button variant="outline" onClick={previewAutoType} disabled={!isTauri()}>
                  <Wand2 className="h-4 w-4" /> Auto-type
                </Button>
              )}
              {accounts.length > 0 && (
                <Button asChild variant="outline" disabled={!isTauri()}>
                  <Link to={`/update?month=${currentMonth()}`}>
                    <CalendarCheck className="h-4 w-4" /> Update this month
                  </Link>
                </Button>
              )}
              <Button asChild variant="outline" disabled={!isTauri()}>
                <Link to="/import">
                  <Upload className="h-4 w-4" /> Import
                </Link>
              </Button>
              <Button data-testid="account-add-button" onClick={() => { setAdding(true); setEditing(null); }} disabled={!isTauri()}>
                <Plus className="h-4 w-4" /> Add account
              </Button>
            </>
          )}
        </div>
      </header>

      {selectMode && (
        <Card className="mb-4 border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p className="text-sm text-muted-foreground">
              {selectedIds.length === 0
                ? "Select two or more accounts to merge them into one."
                : `${selectedIds.length} selected.`}
            </p>
            <Button size="sm" disabled={selectedIds.length < 2} onClick={() => setMerging(true)}>
              <GitMerge className="h-4 w-4" /> Merge {selectedIds.length >= 2 ? selectedIds.length : ""}
            </Button>
          </CardContent>
        </Card>
      )}

      {merging && (
        <div className="mb-4">
          <MergePanel
            accounts={selectedAccounts}
            onConfirm={handleMerge}
            onCancel={() => setMerging(false)}
          />
        </div>
      )}

      {autoTypePreview && (
        <Card className="mb-4 border-primary/40 bg-primary/5">
          <CardContent className="space-y-3 py-4">
            {autoTypePreview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every account's type and institution already match its name — nothing to change.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  Detected a better type or institution for <strong>{autoTypePreview.length}</strong>{" "}
                  account{autoTypePreview.length === 1 ? "" : "s"} from {autoTypePreview.length === 1 ? "its" : "their"} name{autoTypePreview.length === 1 ? "" : "s"}:
                </p>
                <ul className="max-h-72 divide-y overflow-y-auto rounded-md border bg-card text-sm">
                  {autoTypePreview.map((c) => (
                    <li key={c.id} className="flex flex-col gap-1.5 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 truncate">{c.name}</span>
                        <span className="hidden text-xs text-muted-foreground sm:inline">{accountTypeLabel(c.typeFrom)}</span>
                        <span className="text-xs text-muted-foreground">→</span>
                        <Select value={c.type} onValueChange={(v) => setAutoTypeRow(c.id, { type: v as AccountType })}>
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACCOUNT_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {c.institutionProposed && (
                        <div className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                          <span>Institution</span>
                          <span>→</span>
                          <Input
                            className="h-7 w-44 text-xs"
                            value={c.institution}
                            placeholder="(leave blank to skip)"
                            onChange={(e) => setAutoTypeRow(c.id, { institution: e.target.value })}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAutoTypePreview(null)} disabled={autoTyping}>
                {autoTypePreview.length === 0 ? "Close" : "Cancel"}
              </Button>
              {autoTypePreview.length > 0 && (() => {
                const changeCount = autoFixCount(autoTypePreview);
                return (
                  <Button size="sm" onClick={applyAutoType} disabled={autoTyping || changeCount === 0}>
                    <Wand2 className="h-4 w-4" /> {autoTyping ? "Applying…" : `Apply ${changeCount}`}
                  </Button>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Accounts are stored in SQLite, which only runs inside the desktop/mobile app. Start with{" "}
            <code className="rounded bg-amber-200/40 px-1">npm run tauri:dev</code> to add or view accounts.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {adding && (
        <div className="mb-4">
          <AccountForm
            defaultCurrency={currency}
            onSubmit={handleCreate}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name or institution…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search accounts"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as AccountType | "all")}>
            <SelectTrigger className="w-44" aria-label="Filter by type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {typesPresent.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {institutions.length > 0 && (
            <Select value={institutionFilter} onValueChange={setInstitutionFilter}>
              <SelectTrigger className="w-44" aria-label="Filter by institution">
                <SelectValue placeholder="All institutions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All institutions</SelectItem>
                {institutions.map((inst) => (
                  <SelectItem key={inst} value={inst}>{inst}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4" /> Clear
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : accounts.length === 0 ? (
        <EmptyState onAdd={isTauri() ? () => setAdding(true) : undefined} />
      ) : visibleAccounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-medium">No accounts match</p>
            <p className="text-xs text-muted-foreground">
              No accounts match your search and filters.
            </p>
            <Button variant="outline" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4" /> Clear filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" data-testid="accounts-list">
          {visibleAccounts.map((acc) => (
            <li key={acc.id}>
              {editing?.id === acc.id ? (
                <AccountForm
                  initial={acc}
                  defaultCurrency={currency}
                  onSubmit={handleUpdate}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <AccountRow
                  account={acc}
                  selectMode={selectMode}
                  selected={selectedIds.includes(acc.id)}
                  onToggleSelect={() => toggleSelected(acc.id)}
                  onEdit={() => setEditing(acc)}
                  onArchive={() => handleArchive(acc)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived" : "Show archived"}
        </Button>
      </div>

      {isTauri() && (snapshotCount > 0 || accountCount > 0) && (
        <Card className="mt-8 border-destructive/40">
          <CardContent className="space-y-4 py-4">
            <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>

            {snapshotCount > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Clear account data</span> — deletes all{" "}
                  {snapshotCount} monthly value{snapshotCount === 1 ? "" : "s"} across every account. The accounts
                  themselves, goals, tax, and settings are kept. This cannot be undone.
                </p>
                {confirming === "data" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">Delete every monthly value?</span>
                    <Button variant="destructive" size="sm" onClick={() => runClear(clearAllSnapshots)} disabled={clearing}>
                      {clearing ? "Clearing…" : "Yes, delete data"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={clearing}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setConfirming("data")} disabled={clearing}>
                    <Trash2 className="h-4 w-4" /> Clear account data
                  </Button>
                )}
              </div>
            )}

            {accountCount > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Clear accounts</span> — removes all {accountCount}{" "}
                  account{accountCount === 1 ? "" : "s"} and their monthly values. Goals and settings are kept.
                  This cannot be undone.
                </p>
                {confirming === "accounts" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">Delete every account?</span>
                    <Button variant="destructive" size="sm" onClick={() => runClear(clearAllAccounts)} disabled={clearing}>
                      {clearing ? "Clearing…" : "Yes, delete accounts"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={clearing}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setConfirming("accounts")} disabled={clearing}>
                    <Trash2 className="h-4 w-4" /> Clear accounts
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AccountRow({
  account,
  selectMode,
  selected,
  onToggleSelect,
  onEdit,
  onArchive,
}: {
  account: Account;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const archived = account.is_archived === 1;
  const meta = (
    <>
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{account.name}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {account.type === "other" && account.type_note ? account.type_note : accountTypeLabel(account.type)}
        </span>
        {archived && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Archived
          </span>
        )}
        <SipChip account={account} />
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {account.institution ?? "—"} · Opening {formatMoney(account.opening_balance, account.currency)}
      </p>
    </>
  );

  return (
    <Card className={[archived ? "opacity-60" : "", selected ? "ring-2 ring-primary" : ""].join(" ").trim() || undefined}>
      <CardContent className="flex items-center gap-3 p-4">
        {selectMode ? (
          <label className="flex flex-1 min-w-0 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-primary"
              checked={selected}
              onChange={onToggleSelect}
            />
            <span className="min-w-0 flex-1">{meta}</span>
          </label>
        ) : (
          <>
            <Link to={`/accounts/${account.id}`} data-testid="account-row" className="flex-1 min-w-0">
              {meta}
            </Link>
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onArchive} aria-label={archived ? "Restore" : "Archive"}>
              {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MergePanel({
  accounts,
  onConfirm,
  onCancel,
}: {
  accounts: Account[];
  onConfirm: (survivorId: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [survivorId, setSurvivorId] = useState<number>(accounts[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const survivor = accounts.find((a) => a.id === survivorId) ?? accounts[0];
  const currencyMismatch = accounts.some((a) => a.currency !== survivor?.currency);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(survivorId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-4 py-4">
        <div>
          <h3 className="text-sm font-semibold">Merge {accounts.length} accounts</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick the account to keep. Its name, type, currency and credential are kept; the others'
            monthly values are moved onto it. Where both have a value for the same month, the kept
            account's value wins. The other accounts are then deleted. This cannot be undone.
          </p>
        </div>

        <fieldset className="space-y-2">
          {accounts.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="merge-survivor"
                className="h-4 w-4 accent-primary"
                checked={survivorId === a.id}
                onChange={() => setSurvivorId(a.id)}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{a.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {a.type === "other" && a.type_note ? a.type_note : accountTypeLabel(a.type)}
                  {a.institution ? ` · ${a.institution}` : ""}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {currencyMismatch && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Heads up: the selected accounts use different currencies. Moved values keep their original
            numbers and are not converted.
          </p>
        )}

        {err && <p className="text-xs text-destructive">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={run} disabled={busy}>
            <GitMerge className="h-4 w-4" /> {busy ? "Merging…" : `Merge into “${survivor?.name ?? ""}”`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm font-medium">No accounts yet</p>
        <p className="text-xs text-muted-foreground">
          Add a bank account, credit card, or investment to start tracking your money.
        </p>
        {onAdd && (
          <Button onClick={onAdd}>
            <Plus className="h-4 w-4" /> Add your first account
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
