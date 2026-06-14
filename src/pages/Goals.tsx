import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Archive, ArchiveRestore, Target, Sparkles, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTauri } from "@/lib/environment";
import { useSettingsStore } from "@/stores/settings.store";
import { formatMoney, formatMonthLabel } from "@/lib/format";
import { totalsByMonth } from "@/db/aggregates";
import {
  archiveGoal, clearAllGoals, countGoals, createGoal, listGoals, updateGoal, type Goal, type GoalInput,
} from "@/db/goals";
import { computeGoalProgress, type GoalProgress } from "@/domain/goals";
import { lifeGoalByValue, spriteTileStyle } from "@/domain/lifeGoals";
import { LifeGoalPicker, type TemplatePick } from "@/components/goals/LifeGoalPicker";
import { useGatingStore } from "@/stores/gating.store";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(64),
  target_amount: z.coerce.number().positive("Must be > 0"),
  target_date: z.string().optional(),
  baseline_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM").or(z.literal("")).optional(),
});

type FormValues = z.infer<typeof schema>;

/** Pre-fill for a new goal coming from a life-goal template tile. */
interface GoalPrefill {
  name: string;
  target_amount: number;
  category: string | null;
}

export function GoalsPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const refreshGating = useGatingStore((s) => s.refresh);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [prefill, setPrefill] = useState<GoalPrefill | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [goalCount, setGoalCount] = useState(0);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [g, t, count] = await Promise.all([
        listGoals({ includeArchived: showArchived }),
        totalsByMonth(),
        countGoals(),
      ]);
      setGoals(g);
      setTotals(t);
      setGoalCount(count);
      // Having at least one goal unlocks FIRE planning.
      void refreshGating();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showArchived, refreshGating]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleClearGoals = async () => {
    setClearing(true);
    setError(null);
    try {
      await clearAllGoals();
      setConfirmingClear(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
    }
  };

  const startBlank = () => {
    setPrefill(null);
    setEditing(null);
    setAdding(true);
    setGalleryOpen(false);
  };

  const handlePickTemplate = (pick: TemplatePick) => {
    setPrefill({
      name: pick.name,
      target_amount: pick.targetAmount ?? 100000,
      category: pick.category,
    });
    setEditing(null);
    setAdding(true);
    setGalleryOpen(false);
  };

  const closeForm = () => {
    setAdding(false);
    setPrefill(null);
  };

  const handleCreate = async (v: GoalInput) => {
    await createGoal(v);
    closeForm();
    await refresh();
  };
  const handleUpdate = async (v: GoalInput) => {
    if (!editing) return;
    await updateGoal(editing.id, v);
    setEditing(null);
    await refresh();
  };
  const handleArchive = async (g: Goal) => {
    await archiveGoal(g.id, g.archived_at == null);
    await refresh();
  };

  const isEmpty = !loading && goals.length === 0;
  // Show the template gallery prominently in the empty state, otherwise behind a toggle.
  const showGallery = isTauri() && !adding && (isEmpty || galleryOpen);

  return (
    <div className="container max-w-3xl py-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Goals</h2>
          <p className="text-sm text-muted-foreground">Set targets, track progress, see ETA.</p>
        </div>
        <div className="flex items-center gap-2">
          {!isEmpty && (
            <Button variant="outline" onClick={() => setGalleryOpen((v) => !v)} disabled={!isTauri()}>
              <Sparkles className="h-4 w-4" /> Templates
            </Button>
          )}
          <Button data-testid="goal-add-button" onClick={startBlank} disabled={!isTauri()}>
            <Plus className="h-4 w-4" /> Add goal
          </Button>
        </div>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Goals are stored in SQLite — start the desktop app to add and track them.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {showGallery && (
        <Card className="mb-4">
          <CardContent className="space-y-3 p-4">
            <div>
              <h3 className="text-sm font-medium">Start from a life-goal template</h3>
              <p className="text-xs text-muted-foreground">
                Tap a tile to pre-fill a new goal — you can edit everything before saving.
              </p>
            </div>
            <LifeGoalPicker onPick={handlePickTemplate} />
          </CardContent>
        </Card>
      )}

      {adding && (
        <div className="mb-4">
          <GoalForm
            key={prefill ? `tpl:${prefill.category}:${prefill.name}` : "blank"}
            prefill={prefill}
            onSubmit={handleCreate}
            onCancel={closeForm}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : goals.length === 0 ? (
        !showGallery && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Target className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No goals yet</p>
              <p className="text-xs text-muted-foreground">
                Pick a life-goal template above or add a custom savings target.
              </p>
            </CardContent>
          </Card>
        )
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => {
            const progress = computeGoalProgress(g, totals);
            return (
              <li key={g.id}>
                {editing?.id === g.id ? (
                  <GoalForm initial={g} onSubmit={handleUpdate} onCancel={() => setEditing(null)} />
                ) : (
                  <GoalRow
                    progress={progress}
                    currency={currency}
                    onEdit={() => { setEditing(g); setAdding(false); }}
                    onArchive={() => handleArchive(g)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6">
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived" : "Show archived"}
        </Button>
      </div>

      {isTauri() && goalCount > 0 && (
        <Card className="mt-8 border-destructive/40">
          <CardContent className="space-y-3 py-4">
            <div>
              <h3 className="text-sm font-semibold text-destructive">Clear goals</h3>
              <p className="text-xs text-muted-foreground">
                Deletes all {goalCount} goal{goalCount === 1 ? "" : "s"} (including archived).
                Accounts and monthly values are kept. This cannot be undone.
              </p>
            </div>
            {confirmingClear ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">Delete every goal?</span>
                <Button variant="destructive" size="sm" onClick={handleClearGoals} disabled={clearing}>
                  {clearing ? "Clearing…" : "Yes, delete goals"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(false)} disabled={clearing}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmingClear(true)} disabled={clearing}>
                <Trash2 className="h-4 w-4" /> Clear goals
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Small sprite thumbnail for a goal's life-goal category (if any). */
function GoalThumb({ category }: { category: string | null }) {
  const tpl = lifeGoalByValue(category);
  if (!tpl) return null;
  return (
    <span
      className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border/50"
      style={spriteTileStyle(tpl.spriteIndex)}
      aria-hidden
    />
  );
}

function GoalRow({
  progress, currency, onEdit, onArchive,
}: {
  progress: GoalProgress;
  currency: string;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const { goal, progressPct, remaining, currentValue, trailing3mRate, monthsToGoal, projectedMonth, stagnant } = progress;
  const archived = goal.archived_at != null;
  const pct = Math.round(progressPct * 100);

  return (
    <Card data-testid="goal-row" className={archived ? "opacity-60" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <GoalThumb category={goal.category} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-medium">{goal.name}</span>
              {archived && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Archived
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Target {formatMoney(goal.target_amount, currency)}
              {goal.target_date && <> by {goal.target_date}</>}
              {goal.baseline_month && <> · baseline {formatMonthLabel(goal.baseline_month)}</>}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onArchive} aria-label={archived ? "Restore" : "Archive"}>
            {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
        </div>

        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium">{formatMoney(currentValue, currency)} of {formatMoney(goal.target_amount, currency)}</span>
            <span className="tabular-nums text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{formatMoney(remaining, currency)} remaining</span>
          {trailing3mRate != null && (
            <span>· trailing rate {formatMoney(trailing3mRate, currency)}/mo</span>
          )}
          {projectedMonth && monthsToGoal != null && monthsToGoal > 0 && (
            <span data-testid="goal-eta">· ETA {formatMonthLabel(projectedMonth)} ({monthsToGoal} mo)</span>
          )}
          {stagnant && remaining > 0 && (
            <span className="text-amber-700 dark:text-amber-400">· not on track</span>
          )}
          {remaining === 0 && (
            <span className="text-emerald-700 dark:text-emerald-400">· reached</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GoalForm({
  initial, prefill, onSubmit, onCancel,
}: {
  initial?: Goal;
  prefill?: GoalPrefill | null;
  onSubmit: (v: GoalInput) => Promise<void>;
  onCancel: () => void;
}) {
  // Category isn't a typed field — carry it alongside the form so it survives save.
  const [category, setCategory] = useState<string | null>(
    initial?.category ?? prefill?.category ?? null,
  );
  const tpl = lifeGoalByValue(category);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: prefill?.name ?? initial?.name ?? "",
      target_amount: prefill?.target_amount ?? initial?.target_amount ?? 100000,
      target_date: initial?.target_date ?? "",
      baseline_month: initial?.baseline_month ?? "",
    },
  });

  const submit = handleSubmit(async (v) => {
    await onSubmit({
      name: v.name,
      target_amount: v.target_amount,
      target_date: v.target_date || null,
      baseline_month: v.baseline_month || null,
      category,
    });
  });

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4">
      {tpl && (
        <div className="flex items-center gap-3">
          <span
            className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border/50"
            style={spriteTileStyle(tpl.spriteIndex)}
            aria-hidden
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                {tpl.label}
              </span>
              <button
                type="button"
                onClick={() => setCategory(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Remove template"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{tpl.hint}</p>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="g-name">Name</Label>
          <Input id="g-name" data-testid="goal-form-name" placeholder="e.g. Emergency fund" {...register("name")} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-amt">Target amount</Label>
          <Input id="g-amt" data-testid="goal-form-amount" type="number" step="0.01" {...register("target_amount")} />
          {errors.target_amount && <p className="text-xs text-destructive">{errors.target_amount.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-date">Target date <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="g-date" type="date" {...register("target_date")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-base">Baseline month <span className="text-muted-foreground">(optional, YYYY-MM)</span></Label>
          <Input id="g-base" type="month" {...register("baseline_month")} />
          {errors.baseline_month && <p className="text-xs text-destructive">{errors.baseline_month.message}</p>}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
        <Button type="submit" data-testid="goal-form-submit" disabled={isSubmitting}>{initial ? "Save" : "Add goal"}</Button>
      </div>
    </form>
  );
}
