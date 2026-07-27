import { useEffect, useMemo, useState } from "react";
import { X, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { FiniteSetInput } from "@/components/forms/FiniteSetInput";
import { formatMoney, transactionDateLabel } from "@/lib/format";
import {
  DELETE_TRANSACTION_CATEGORY, DELETE_TRANSACTION_OPTION, similarByDescription, suggestCategoryTagsWithRules,
} from "@/domain/transactionCategory";
import { bulkAddTags } from "@/db/transactionTags";
import { deleteTransactionsByIds, type TransactionRow } from "@/db/transactions";
import { getCategoryRuleMap } from "@/db/categoryRules";
import { MASTERS } from "@/masters/registry";

const DELETE_OPTION = [DELETE_TRANSACTION_OPTION];
const CATEGORY_LABELS = new Map(MASTERS.transaction_category.baked.map((o) => [o.value, o.label]));
const HIGH_VALUE_THRESHOLD = 5000;
/** Excluded from the ">5000, consider other categories" nudge — the rail tag
 *  itself is never the "other possible category" being asked about. */
const NUDGE_EXCLUDE = [DELETE_TRANSACTION_CATEGORY, "upi_payment"];

const labelFor = (category: string) => CATEGORY_LABELS.get(category) ?? category;

interface Props {
  /** Rows to work through, one at a time. */
  transactions: TransactionRow[];
  currencyFor: (accountId: number) => string;
  /** The account holder's own name (from the tax filer profile), threaded into the
   *  auto-classifier so it can recognize a self-transfer — see CategoryContext.selfName. */
  selfName?: string;
  /** Tags a row already carries, if any — seeds the chip list and keeps them from
   *  being re-suggested. Defaults to none (the ordinary "classify from scratch"
   *  queue); the UPI/high-value backfill review passes the row's existing
   *  ("upi_payment") tag here so it stays visible while a secondary tag is added. */
  existingTags?: (t: TransactionRow) => string[];
  /** Called once the queue is empty (or the user exits early) — the caller re-fetches. */
  onDone: () => void;
}

/**
 * One unclassified transaction at a time (mirrors TaxWizardPage's one-question
 * pattern) with a pre-checked "apply to similar" shortcut so a repeated
 * narration (e.g. ten Swiggy charges) is classified in one step instead of ten.
 * Each row is tagged with a SET of categories, not one — the tag chips are
 * seeded from every static-rule match plus everything the user has ever taught
 * for this exact narration pattern (suggestCategoryTagsWithRules), and the user
 * can add/remove before saving. A row over ₹5000 additionally surfaces
 * "other possible categories" (re-suggested with the generic UPI rail rule
 * excluded) as one-click, purely optional add-ons — never blocking Save.
 * Saved tags are written `source: "manual"` (bulkAddTags) — a human confirmed
 * them here, even when the picker's defaults came from the same classifier —
 * accepting a re-run suggestion is still a confirmed human choice, not the
 * original unattended import-time guess.
 */
export function CategoryWizard({ transactions, currencyFor, selfName, existingTags, onDone }: Props) {
  const [queue, setQueue] = useState(transactions);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [addTagValue, setAddTagValue] = useState("");
  const [markedForDelete, setMarkedForDelete] = useState(false);
  const [applyToSimilar, setApplyToSimilar] = useState(true);
  const [saving, setSaving] = useState(false);
  const [learnedRules, setLearnedRules] = useState<Map<string, string[]>>(new Map());

  useEffect(() => { void getCategoryRuleMap().then(setLearnedRules); }, []);

  const current = queue[0] ?? null;

  const similarIds = useMemo(() => {
    if (!current) return [];
    return similarByDescription(current.description, queue.slice(1));
  }, [current, queue]);

  // Re-runs the deterministic keyword classifier (+ learned rules) on each row
  // as the wizard reaches it (not just once at import time) so a row that
  // stayed untagged before — e.g. because a rule didn't exist yet, or selfName
  // wasn't set — gets pre-filled chips the user can accept/remove/extend.
  useEffect(() => {
    if (!current) return;
    const isCredit = current.credit != null ? true : current.debit != null ? false : undefined;
    const existing = existingTags?.(current) ?? [];
    const suggestions = suggestCategoryTagsWithRules(current.description, learnedRules, { isCredit, selfName });
    setSelectedTags(new Set([...existing, ...suggestions.map((s) => s.category)]));
    setAddTagValue("");
    setMarkedForDelete(false);
  }, [current, selfName, learnedRules]); // eslint-disable-line react-hooks/exhaustive-deps

  const isHighValue = current != null && Math.abs(current.debit ?? current.credit ?? 0) > HIGH_VALUE_THRESHOLD;

  const extraSuggestions = useMemo(() => {
    if (!current || !isHighValue) return [];
    const isCredit = current.credit != null ? true : current.debit != null ? false : undefined;
    const suggestions = suggestCategoryTagsWithRules(current.description, learnedRules, { isCredit, selfName }, { exclude: NUDGE_EXCLUDE });
    return suggestions.map((s) => s.category).filter((c) => !selectedTags.has(c));
  }, [current, isHighValue, learnedRules, selfName, selectedTags]);

  if (!current) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center text-sm text-muted-foreground">
          <p>All caught up — nothing left to classify.</p>
          <Button onClick={onDone}>Done</Button>
        </CardContent>
      </Card>
    );
  }

  const addTag = (category: string) => setSelectedTags((prev) => new Set(prev).add(category));
  const removeTagChip = (category: string) => setSelectedTags((prev) => {
    const next = new Set(prev);
    next.delete(category);
    return next;
  });

  const handlePick = (value: string) => {
    if (value === DELETE_TRANSACTION_CATEGORY) setMarkedForDelete(true);
    else addTag(value);
    setAddTagValue("");
  };

  const handleSave = async () => {
    if (!markedForDelete && selectedTags.size === 0) return;
    const ids = applyToSimilar ? [current.id, ...similarIds] : [current.id];
    if (markedForDelete) {
      if (!confirm(`Delete ${ids.length} transaction${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    }
    setSaving(true);
    if (markedForDelete) await deleteTransactionsByIds(ids);
    else await bulkAddTags(ids, Array.from(selectedTags), "manual");
    setQueue((q) => q.filter((t) => !ids.includes(t.id)));
    setApplyToSimilar(true);
    setSaving(false);
  };

  /** Leaves the row untagged and moves on — it stays in the backlog and
   *  reappears next time the wizard is opened (unlike Save, this writes nothing). */
  const handleSkip = () => {
    setQueue((q) => q.slice(1));
    setApplyToSimilar(true);
  };

  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <p className="text-xs text-muted-foreground">{queue.length} left to classify</p>

        <div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium">{transactionDateLabel(current)}</span>
            <span className="text-xs font-medium text-muted-foreground">
              {current.debit != null ? "To:" : current.credit != null ? "From:" : null}
            </span>
            <span className="text-sm">{current.description}</span>
          </div>
          <div className="tabular-nums text-sm text-muted-foreground">
            {current.debit != null && <>-{formatMoney(current.debit, currencyFor(current.account_id))}</>}
            {current.credit != null && <>+{formatMoney(current.credit, currencyFor(current.account_id))}</>}
            {current.debit == null && current.credit == null && (
              current.balance != null ? `Bal: ${formatMoney(current.balance, currencyFor(current.account_id))}` : "—"
            )}
          </div>
        </div>

        {markedForDelete ? (
          <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            <span>Marked for deletion.</span>
            <Button variant="ghost" size="sm" onClick={() => setMarkedForDelete(false)}>Undo</Button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label>Category tags</Label>
              {selectedTags.size > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(selectedTags).map((c) => (
                    <span key={c} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
                      {labelFor(c)}
                      <button type="button" aria-label={`Remove ${labelFor(c)}`} onClick={() => removeTagChip(c)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <FiniteSetInput
                id="wizard-add-tag"
                masterId="transaction_category"
                value={addTagValue}
                onChange={handlePick}
                placeholder="Add a category tag"
                extraOptions={DELETE_OPTION}
              />
            </div>

            {extraSuggestions.length > 0 && (
              <div className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-2.5">
                <p className="flex items-center gap-1 text-xs font-medium text-primary">
                  <Lightbulb className="h-3.5 w-3.5" /> High-value — also consider:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {extraSuggestions.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => addTag(c)}
                      className="rounded-full border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                    >
                      + {labelFor(c)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {similarIds.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-primary"
              checked={applyToSimilar}
              onChange={(e) => setApplyToSimilar(e.target.checked)}
            />
            Apply to the {similarIds.length} other transaction{similarIds.length === 1 ? "" : "s"} that look like this too
          </label>
        )}

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onDone} disabled={saving}>Exit</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSkip} disabled={saving}>Skip</Button>
            <Button
              onClick={handleSave}
              disabled={(!markedForDelete && selectedTags.size === 0) || saving}
              variant={markedForDelete ? "destructive" : "default"}
            >
              {saving ? (markedForDelete ? "Deleting…" : "Saving…") : markedForDelete ? "Delete & next" : "Save & next"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
