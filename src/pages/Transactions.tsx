import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Wand2, CheckSquare, ArrowUp, ArrowDown, Trash2, Download, Check, GitMerge, Lightbulb, ChevronDown, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FiniteSetInput } from "@/components/forms/FiniteSetInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { DesktopOnlyNotice } from "@/components/layout/DesktopOnlyNotice";
import { CategoryWizard } from "@/components/transactions/CategoryWizard";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { isTauri } from "@/lib/environment";
import { formatMoney, transactionDateLabel } from "@/lib/format";
import { DELETE_TRANSACTION_CATEGORY, DELETE_TRANSACTION_OPTION, suggestCategoryTagsWithRules } from "@/domain/transactionCategory";
import {
  listAllTransactions, deleteTransactionsByIds, deleteTransactionsForAccount,
  deleteAllTransactions, type TransactionRow,
} from "@/db/transactions";
import { listAllTags, bulkAddTags, removeTag } from "@/db/transactionTags";
import { listCategoryRules, deleteCategoryRule, getCategoryRuleMap, type CategoryRuleRow } from "@/db/categoryRules";
import { listAccounts, type Account } from "@/db/accounts";
import { listAllLinks } from "@/db/reconLinks";
import { loadTaxProfile } from "@/tax/taxProfile";
import { MASTERS } from "@/masters/registry";

const UNCATEGORIZED = "__uncategorized__";
const CATEGORY_LABELS = new Map(MASTERS.transaction_category.baked.map((o) => [o.value, o.label]));
const DELETE_OPTION = [DELETE_TRANSACTION_OPTION];
const HIGH_VALUE_THRESHOLD = 5000;
const UPI_RAIL_CATEGORY = "upi_payment";

type ViewMode = "list" | "wizard" | "bulk" | "backfill";
type SortKey = "date" | "category" | "counterparty";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  date: "Date",
  category: "Category",
  counterparty: "Payer / Receiver",
};

/**
 * Cross-account transaction ledger view (desktop-only, see AccountDetail's
 * per-account section for the same data scoped to one account). Filters run
 * client-side over one fetch — this app's SQLite DB is local and small enough
 * that a server-side filtered query isn't worth the extra code path (mirrors
 * Accounts.tsx's own client-side filtering).
 *
 * Two classification entry points: the one-at-a-time wizard (`CategoryWizard`,
 * best for a fresh small backlog after an import) and this page's own bulk
 * mode (checkbox multi-select + "select all matching text", best for clearing
 * a large backlog at once) — both write tags with `source: "manual"`. A
 * transaction can carry more than one category tag (a UPI grocery payment
 * keeps both "upi_payment" and "groceries"); bulk mode is additive — applying
 * a category never removes what's already there, so the same selection can be
 * re-applied with a second category to layer on more tags.
 *
 * The plain list view (not bulk/wizard) also supports correcting an
 * already-tagged row directly: each tag chip gets a remove ("x") and, when the
 * tag matches something `suggestCategoryTagsWithRules` would suggest today
 * (recomputed live — nothing extra is persisted), an "i" toggle that reveals
 * WHICH rule is responsible — the learned pattern (with an inline "Forget",
 * same action as the "Learned rules" panel) or the built-in keyword — so a
 * wrong auto-tag can be traced to the rule that needs fixing, right where it's
 * seen, rather than hunting through the separate learned-rules summary.
 */
export function TransactionsPage() {
  const [searchParams] = useSearchParams();
  const isDesktop = useIsDesktop();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [matchCounts, setMatchCounts] = useState<Map<number, number>>(new Map());
  const [tagsByTxn, setTagsByTxn] = useState<Map<number, string[]>>(new Map());
  const [categoryRules, setCategoryRules] = useState<CategoryRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountFilter, setAccountFilter] = useState(searchParams.get("account") ?? "all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [nameFilter, setNameFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkFilterText, setBulkFilterText] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [selfName, setSelfName] = useState<string | undefined>(undefined);
  const [backfillQueue, setBackfillQueue] = useState<TransactionRow[] | null>(null);
  const [backfillScanning, setBackfillScanning] = useState(false);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [addTagDraft, setAddTagDraft] = useState("");
  const [explainKey, setExplainKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri() || !isDesktop) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [txns, accts, links, tags, rules] = await Promise.all([
      listAllTransactions(),
      listAccounts({ includeArchived: true }),
      listAllLinks(),
      listAllTags(),
      listCategoryRules(),
    ]);
    setTransactions(txns);
    setAccounts(accts);
    setCategoryRules(rules);
    const tagMap = new Map<number, string[]>();
    for (const t of tags) {
      const list = tagMap.get(t.transaction_id);
      if (list) list.push(t.category);
      else tagMap.set(t.transaction_id, [t.category]);
    }
    setTagsByTxn(tagMap);
    // Only CONFIRMED links earn a tag — a merely-suggested candidate hasn't
    // been reviewed yet, so it shouldn't visually claim a match.
    const counts = new Map<number, number>();
    for (const l of links) {
      if (l.status !== "confirmed") continue;
      if (l.a_kind === "transaction") counts.set(l.a_id, (counts.get(l.a_id) ?? 0) + 1);
      if (l.b_kind === "transaction") counts.set(l.b_id, (counts.get(l.b_id) ?? 0) + 1);
    }
    setMatchCounts(counts);
    setLoading(false);
  }, [isDesktop]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void loadTaxProfile().then((profile) => setSelfName(profile.name.trim() || undefined)); }, []);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const currencyFor = useCallback((accountId: number) => accountById.get(accountId)?.currency ?? "INR", [accountById]);

  const tagsFor = useCallback((id: number) => tagsByTxn.get(id) ?? [], [tagsByTxn]);

  // Built from the already-fetched `categoryRules` rows rather than a second
  // getCategoryRuleMap() query — same shape suggestCategoryTagsWithRules expects.
  const learnedRuleMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of categoryRules) {
      const list = map.get(r.pattern);
      if (list) list.push(r.category);
      else map.set(r.pattern, [r.category]);
    }
    return map;
  }, [categoryRules]);

  /** Recomputes today's suggestions for this row and finds the one matching
   *  `category` — nothing about "why" a tag exists is persisted, so this is
   *  always a live re-derivation, same inputs the wizard/import-time tagging used. */
  const explainTag = useCallback(
    (t: TransactionRow, category: string) => {
      const isCredit = t.credit != null ? true : t.debit != null ? false : undefined;
      const suggestions = suggestCategoryTagsWithRules(t.description, learnedRuleMap, { isCredit, selfName });
      return suggestions.find((s) => s.category === category);
    },
    [learnedRuleMap, selfName],
  );

  const ruleIdFor = useCallback(
    (pattern: string, category: string) => categoryRules.find((r) => r.pattern === pattern && r.category === category)?.id,
    [categoryRules],
  );

  const filtered = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase();
    return transactions.filter((t) => {
      if (accountFilter !== "all" && String(t.account_id) !== accountFilter) return false;
      const tags = tagsFor(t.id);
      if (categoryFilter === UNCATEGORIZED && tags.length > 0) return false;
      if (categoryFilter !== "all" && categoryFilter !== UNCATEGORIZED && !tags.includes(categoryFilter)) return false;
      // Substring match on any run of consecutive letters, anywhere in the
      // description — not just a prefix — so e.g. "swiggy" also groups
      // "UPI-SWIGGY-ORDER456" together with "SWIGGY INSTAMART PAYMENT".
      if (needle && !t.description.toLowerCase().includes(needle)) return false;
      if (fromDate && (!t.date || t.date < fromDate)) return false;
      if (toDate && (!t.date || t.date > toDate)) return false;
      return true;
    });
  }, [transactions, accountFilter, categoryFilter, nameFilter, fromDate, toDate, tagsFor]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const categoryLabel = (t: TransactionRow) => tagsFor(t.id).map((c) => CATEGORY_LABELS.get(c) ?? c).sort().join(", ");
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = (a.date ?? a.raw_date).localeCompare(b.date ?? b.raw_date);
      else if (sortKey === "category") cmp = categoryLabel(a).localeCompare(categoryLabel(b));
      else cmp = a.description.localeCompare(b.description);
      if (cmp === 0) cmp = a.id - b.id;
      return cmp * dir;
    });
  }, [filtered, sortKey, sortDir, tagsFor]);

  const usedCategories = useMemo(
    () => Array.from(new Set(Array.from(tagsByTxn.values()).flat())).sort(),
    [tagsByTxn],
  );

  const unclassified = useMemo(() => transactions.filter((t) => tagsFor(t.id).length === 0), [transactions, tagsFor]);

  const upiHighValueCount = useMemo(
    () => transactions.filter((t) => tagsFor(t.id).includes(UPI_RAIL_CATEGORY) && Math.abs(t.debit ?? t.credit ?? 0) > HIGH_VALUE_THRESHOLD).length,
    [transactions, tagsFor],
  );

  const exitToList = () => {
    setViewMode("list");
    setBulkSelected(new Set());
    setBulkFilterText("");
    setBulkCategory("");
    setBackfillQueue(null);
    void refresh();
  };

  const selectMatching = () => {
    const needle = bulkFilterText.trim().toLowerCase();
    if (!needle) return;
    setBulkSelected((prev) => {
      const next = new Set(prev);
      for (const t of filtered) if (t.description.toLowerCase().includes(needle)) next.add(t.id);
      return next;
    });
  };

  const bulkIsDelete = bulkCategory === DELETE_TRANSACTION_CATEGORY;

  /** Additive: applying a category never removes an existing tag, so the same
   *  selection can be re-applied with a second category to layer on more tags
   *  (e.g. tag a batch "upi_payment", then again "groceries"). Only a delete
   *  exits bulk mode; a plain tag-apply just refreshes and stays put. */
  const applyBulkCategory = async () => {
    if (!bulkCategory || bulkSelected.size === 0) return;
    const ids = Array.from(bulkSelected);
    if (bulkIsDelete) {
      if (!confirm(`Delete ${ids.length} transaction${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    }
    setBulkApplying(true);
    if (bulkIsDelete) {
      await deleteTransactionsByIds(ids);
      setBulkApplying(false);
      exitToList();
      return;
    }
    await bulkAddTags(ids, [bulkCategory], "manual");
    setBulkApplying(false);
    setBulkCategory("");
    await refresh();
  };

  /** One-time, user-triggered re-scan (never automatic): finds transactions
   *  already tagged "upi_payment" over ₹5000 whose narration also matches a
   *  more specific rule/learned pattern the generic rail tag didn't capture,
   *  and walks the user through confirming each one via CategoryWizard. */
  const startUpiBackfill = async () => {
    setBackfillScanning(true);
    const learnedRules = await getCategoryRuleMap();
    const candidates = transactions.filter((t) => {
      const tags = tagsFor(t.id);
      if (!tags.includes(UPI_RAIL_CATEGORY) || Math.abs(t.debit ?? t.credit ?? 0) <= HIGH_VALUE_THRESHOLD) return false;
      const isCredit = t.credit != null ? true : t.debit != null ? false : undefined;
      const suggestions = suggestCategoryTagsWithRules(t.description, learnedRules, { isCredit, selfName }, { exclude: [UPI_RAIL_CATEGORY] });
      return suggestions.some((s) => !tags.includes(s.category));
    });
    setBackfillScanning(false);
    if (candidates.length === 0) {
      alert("No additional categories found for existing UPI transactions over ₹5000.");
      return;
    }
    setBackfillQueue(candidates);
    setViewMode("backfill");
  };

  const forgetRule = async (id: number) => {
    await deleteCategoryRule(id);
    await refresh();
  };

  /** Removes one wrong (or just unwanted) tag from one already-tagged
   *  transaction — the correction affordance the plain list view was missing;
   *  previously a tag could only be added (wizard/bulk), never taken back off. */
  const handleRemoveTag = async (transactionId: number, category: string) => {
    setExplainKey(null);
    await removeTag(transactionId, category);
    await refresh();
  };

  /** Adds one manual tag to one row from the inline "+ Add" control. */
  const handleAddInlineTag = async (transactionId: number, category: string) => {
    if (!category) return;
    setEditingRowId(null);
    setAddTagDraft("");
    await bulkAddTags([transactionId], [category], "manual");
    await refresh();
  };

  const toggleExplain = (key: string) => setExplainKey((prev) => (prev === key ? null : key));

  /** Wipes the ledger — scoped to the current account filter if one is set,
   *  otherwise every account. A blunt reset (ignores category/date/name
   *  filters), distinct from the filtered bulk-delete flow above. */
  const clearAllTransactions = async () => {
    const scoped = accountFilter !== "all";
    const count = scoped ? transactions.filter((t) => String(t.account_id) === accountFilter).length : transactions.length;
    if (count === 0) return;
    const scopeLabel = scoped ? accountById.get(Number(accountFilter))?.name ?? "this account" : "ALL accounts";
    if (!confirm(`Delete all ${count} transaction${count === 1 ? "" : "s"} for ${scopeLabel}? This cannot be undone.`)) return;
    if (scoped) await deleteTransactionsForAccount(Number(accountFilter));
    else await deleteAllTransactions();
    await refresh();
  };

  /** Dumps exactly the rows currently visible (post-filter, in the shown
   *  sort order) to `<AppData>/debug-logs/`, same convention/location as the
   *  import-time parse dumps (`writeDebugDump`) — so a user can hand over a
   *  structured file of what the ledger actually holds after import/commit,
   *  rather than describing it row by row. Unlike those best-effort dumps
   *  this is a user-triggered action, so failures surface instead of being
   *  swallowed. */
  const exportVisibleTransactions = async () => {
    setExporting(true);
    setExportedPath(null);
    try {
      const fs = await import("@tauri-apps/plugin-fs");
      const { stringify } = await import("yaml");
      const dir = "debug-logs";
      await fs.mkdir(dir, { baseDir: fs.BaseDirectory.AppData, recursive: true }).catch(() => undefined);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `${dir}/${stamp}-transactions-view.yaml`;
      const payload = {
        filters: {
          account: accountFilter === "all" ? "all" : accountById.get(Number(accountFilter))?.name ?? accountFilter,
          category: categoryFilter,
          descriptionContains: nameFilter || null,
          fromDate: fromDate || null,
          toDate: toDate || null,
          sortKey,
          sortDir,
        },
        count: sorted.length,
        transactions: sorted.map((t) => ({
          id: t.id,
          account: accountById.get(t.account_id)?.name ?? `Account ${t.account_id}`,
          date: t.date,
          raw_date: t.raw_date,
          description: t.description,
          debit: t.debit,
          credit: t.credit,
          balance: t.balance,
          tags: tagsFor(t.id),
          source_path: t.source_path,
        })),
      };
      await fs.writeFile(path, new TextEncoder().encode(stringify(payload, { indent: 2 })), {
        baseDir: fs.BaseDirectory.AppData,
      });
      setExportedPath(path);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-4xl py-6">
        <PageHeader backTo="/accounts" backLabel="Back to accounts" title="Transactions" />
        <DesktopOnlyNotice feature="The transaction ledger" />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6">
      <PageHeader
        backTo="/accounts"
        backLabel="Back to accounts"
        title="Transactions"
        description="Every transaction imported from a bank/credit-card statement, across all accounts."
        actions={
          viewMode === "list" && !loading && isDesktop ? (
            <>
              <Button asChild variant="outline">
                <Link to="/tax">
                  <GitMerge className="h-4 w-4" /> Reconcile with tax documents
                </Link>
              </Button>
              <Button variant="outline" onClick={() => void exportVisibleTransactions()} disabled={exporting || sorted.length === 0}>
                {exportedPath ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                {exporting ? "Exporting…" : exportedPath ? "Exported" : "Export view"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <Wand2 className="h-4 w-4" /> Classify <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setViewMode("wizard")} disabled={unclassified.length === 0}>
                    <Wand2 className="h-4 w-4" /> Classify transactions ({unclassified.length})
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setViewMode("bulk")} disabled={filtered.length === 0}>
                    <CheckSquare className="h-4 w-4" /> Bulk classify
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void startUpiBackfill()} disabled={backfillScanning || upiHighValueCount === 0}>
                    <Lightbulb className="h-4 w-4" />
                    {backfillScanning ? "Scanning…" : `Find secondary categories (${upiHighValueCount})`}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="destructive" onClick={() => void clearAllTransactions()} disabled={transactions.length === 0}>
                <Trash2 className="h-4 w-4" /> Clear all transactions
              </Button>
            </>
          ) : undefined
        }
      />
      {exportedPath && viewMode === "list" && !loading && isDesktop && (
        <p className="mb-4 -mt-2 text-xs text-muted-foreground">Saved to app data: {exportedPath}</p>
      )}

      {!isDesktop ? (
        <DesktopOnlyNotice feature="The transaction ledger" />
      ) : loading ? (
        <div className="py-6 text-sm text-muted-foreground">Loading…</div>
      ) : viewMode === "wizard" ? (
        <CategoryWizard transactions={unclassified} currencyFor={currencyFor} selfName={selfName} onDone={exitToList} />
      ) : viewMode === "backfill" && backfillQueue ? (
        <CategoryWizard
          transactions={backfillQueue}
          currencyFor={currencyFor}
          selfName={selfName}
          existingTags={(t) => tagsFor(t.id)}
          onDone={exitToList}
        />
      ) : (
        <>
          {categoryRules.length > 0 && (
            <details className="mb-4 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Learned rules ({categoryRules.length})</summary>
              <ul className="mt-2 space-y-1 pl-4">
                {categoryRules.map((r) => (
                  <li key={r.id} className="flex list-disc items-center justify-between gap-2">
                    <span>
                      <span className="font-medium text-foreground">{r.pattern}</span>
                      {" → "}
                      {CATEGORY_LABELS.get(r.category) ?? r.category} (seen {r.hit_count}×)
                    </span>
                    <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => void forgetRule(r.id)}>
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Card className="mb-4">
            <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div className="space-y-1">
                <Label htmlFor="txn-acct-filter">Account</Label>
                <Select value={accountFilter} onValueChange={setAccountFilter}>
                  <SelectTrigger id="txn-acct-filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All accounts</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="txn-cat-filter">Category</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger id="txn-cat-filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
                    {usedCategories.map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABELS.get(c) ?? c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="txn-name-filter">Description contains</Label>
                <Input
                  id="txn-name-filter"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  placeholder="e.g. swiggy"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="txn-from">From</Label>
                <Input id="txn-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="txn-to">To</Label>
                <Input id="txn-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="txn-sort">Sort by</Label>
                <div className="flex gap-1">
                  <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                    <SelectTrigger id="txn-sort"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                        <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    aria-label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
                    onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  >
                    {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {viewMode === "bulk" && (
            <Card className="mb-4 border-primary/40">
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[200px] space-y-1">
                    <Label htmlFor="bulk-filter">Select all whose description contains…</Label>
                    <Input id="bulk-filter" value={bulkFilterText} onChange={(e) => setBulkFilterText(e.target.value)} placeholder="e.g. swiggy" />
                  </div>
                  <Button variant="outline" onClick={selectMatching} disabled={!bulkFilterText.trim()}>Select matching</Button>
                  <Button
                    variant="outline"
                    onClick={() => setBulkSelected(new Set(sorted.map((t) => t.id)))}
                    disabled={sorted.length === 0}
                  >
                    Select all shown ({sorted.length})
                  </Button>
                  <Button variant="ghost" onClick={() => setBulkSelected(new Set())} disabled={bulkSelected.size === 0}>Clear selection</Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px] flex-1 space-y-1">
                    <Label htmlFor="bulk-category">Category for {bulkSelected.size} selected</Label>
                    <FiniteSetInput
                      id="bulk-category"
                      masterId="transaction_category"
                      value={bulkCategory}
                      onChange={setBulkCategory}
                      placeholder="Choose a category"
                      extraOptions={DELETE_OPTION}
                    />
                  </div>
                  <Button
                    onClick={applyBulkCategory}
                    disabled={bulkSelected.size === 0 || !bulkCategory || bulkApplying}
                    variant={bulkIsDelete ? "destructive" : "default"}
                  >
                    {bulkApplying
                      ? (bulkIsDelete ? "Deleting…" : "Applying…")
                      : bulkIsDelete ? `Delete ${bulkSelected.size} selected` : `Apply to ${bulkSelected.size} selected`}
                  </Button>
                  <Button variant="ghost" onClick={exitToList} disabled={bulkApplying}>Exit</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {sorted.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No transactions match these filters.
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {sorted.map((t) => {
                const acct = accountById.get(t.account_id);
                return (
                  <li key={t.id} className="flex items-center gap-3 p-3">
                    {viewMode === "bulk" && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-primary"
                        checked={bulkSelected.has(t.id)}
                        onChange={(e) => {
                          setBulkSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(t.id); else next.delete(t.id);
                            return next;
                          });
                        }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{transactionDateLabel(t)}</span>
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          {t.debit != null ? "To:" : t.credit != null ? "From:" : null}
                        </span>
                        <span className="truncate text-sm text-muted-foreground">{t.description}</span>
                      </div>
                      <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>{acct?.name ?? `Account ${t.account_id}`}</span>
                        {matchCounts.has(t.id) && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5 normal-case text-primary">
                              <GitMerge className="h-3 w-3" /> Matched with {matchCounts.get(t.id)} document{matchCounts.get(t.id) === 1 ? "" : "s"}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {tagsFor(t.id).length > 0 ? (
                          tagsFor(t.id).map((c) => {
                            const key = `${t.id}:${c}`;
                            const explanation = viewMode === "list" ? explainTag(t, c) : undefined;
                            return (
                              <span key={c} className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
                                {CATEGORY_LABELS.get(c) ?? c}
                                {viewMode === "list" && explanation && (
                                  <button
                                    type="button"
                                    onClick={() => toggleExplain(key)}
                                    aria-label={`Show which rule suggested ${CATEGORY_LABELS.get(c) ?? c}`}
                                    title="Show which rule suggested this tag"
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    <Info className="h-2.5 w-2.5" />
                                  </button>
                                )}
                                {viewMode === "list" && (
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveTag(t.id, c)}
                                    aria-label={`Remove ${CATEGORY_LABELS.get(c) ?? c}`}
                                    className="text-muted-foreground hover:text-destructive"
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                )}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Uncategorized</span>
                        )}
                        {viewMode === "list" && (
                          editingRowId === t.id ? (
                            <span className="flex w-72 shrink-0 items-center gap-1">
                              <FiniteSetInput
                                id={`add-tag-${t.id}`}
                                masterId="transaction_category"
                                value={addTagDraft}
                                onChange={(v) => void handleAddInlineTag(t.id, v)}
                                placeholder="Add tag"
                              />
                              <button
                                type="button"
                                aria-label="Cancel adding a tag"
                                title="Cancel"
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                                onClick={() => setEditingRowId(null)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-[10px] text-primary hover:underline"
                              onClick={() => { setEditingRowId(t.id); setAddTagDraft(""); }}
                            >
                              + Add
                            </button>
                          )
                        )}
                      </div>
                      {viewMode === "list" && tagsFor(t.id).map((c) => {
                        const key = `${t.id}:${c}`;
                        if (explainKey !== key) return null;
                        const explanation = explainTag(t, c);
                        if (!explanation) return null;
                        const ruleId = explanation.source === "learned" ? ruleIdFor(explanation.learnedPattern ?? "", c) : undefined;
                        return (
                          <div key={key} className="mt-1 flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[10px]">
                            <span>
                              {explanation.source === "learned" ? (
                                <>Learned rule: narration pattern <span className="font-medium">"{explanation.learnedPattern}"</span> was taught as {CATEGORY_LABELS.get(c) ?? c}. Wrong? Forget it below.</>
                              ) : (
                                <>Built-in rule: matched keyword <span className="font-medium">/{explanation.matchedKeyword}/</span>. Remove the tag above if this is wrong.</>
                              )}
                            </span>
                            {ruleId != null && (
                              <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => void forgetRule(ruleId)}>
                                Forget this rule
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-right tabular-nums">
                      {t.debit != null && (
                        <div className="font-medium text-destructive">-{formatMoney(t.debit, acct?.currency ?? "INR")}</div>
                      )}
                      {t.credit != null && (
                        <div className="font-medium text-emerald-600 dark:text-emerald-400">+{formatMoney(t.credit, acct?.currency ?? "INR")}</div>
                      )}
                      {t.debit == null && t.credit == null && (
                        <div className="text-muted-foreground">
                          {t.balance != null ? `Bal: ${formatMoney(t.balance, acct?.currency ?? "INR")}` : "—"}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
