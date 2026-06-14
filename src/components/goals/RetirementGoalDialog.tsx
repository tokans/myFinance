import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createGoal } from "@/db/goals";
import { useGatingStore } from "@/stores/gating.store";
import {
  HEALTHY_RETIREMENT_CATEGORY,
  lifeGoalByValue,
  spriteTileStyle,
} from "@/domain/lifeGoals";

const TEMPLATE = lifeGoalByValue(HEALTHY_RETIREMENT_CATEGORY)!;

/**
 * In-place "Add a Healthy Retirement goal" popup. Used from the FIRE locked
 * screen so the user can create the goal that unlocks (and is refined by) FIRE
 * planning without leaving the page. Pre-filled from the life-goal template;
 * everything stays editable. On success it refreshes gating, which flips the
 * FIRE gate open automatically (see FeatureGuard).
 */
export function RetirementGoalDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: () => void;
}) {
  const refreshGating = useGatingStore((s) => s.refresh);
  const [name, setName] = useState(TEMPLATE.label);
  const [amount, setAmount] = useState(String(TEMPLATE.defaultTarget ?? ""));
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to template defaults each time the dialog is opened.
  useEffect(() => {
    if (open) {
      setName(TEMPLATE.label);
      setAmount(String(TEMPLATE.defaultTarget ?? ""));
      setDate("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const numAmount = Number(amount);
  const canSubmit = name.trim().length > 0 && Number.isFinite(numAmount) && numAmount > 0;

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createGoal({
        name: name.trim(),
        target_amount: numAmount,
        target_date: date || null,
        category: HEALTHY_RETIREMENT_CATEGORY,
      });
      await refreshGating();
      onOpenChange(false);
      onAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <div className="flex items-start gap-3">
            <span
              className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border/50"
              style={spriteTileStyle(TEMPLATE.spriteIndex)}
              aria-hidden
            />
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold tracking-tight">
                Add a Healthy Retirement goal
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {TEMPLATE.hint} — FIRE planning refines this target.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rg-name">Name</Label>
              <Input
                id="rg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                maxLength={64}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rg-amt">Target amount</Label>
              <Input
                id="rg-amt"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rg-date">
                Target date <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="rg-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" data-testid="retirement-goal-submit" disabled={!canSubmit || busy}>
                {busy ? "Adding…" : "Add goal"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
