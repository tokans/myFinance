import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isTauri } from "@/lib/environment";

/**
 * A single destructive "clear this feature's data" action, rendered with an
 * inline two-step confirm (mirrors the Accounts page danger zone). An action
 * with `count === 0` is hidden — there is nothing to clear.
 */
export interface DangerAction {
  /** Stable key driving the inline-confirm toggle. */
  id: string;
  /** Trigger button label, e.g. "Clear tax records". */
  label: string;
  /** Explanatory copy shown above the button. */
  description: ReactNode;
  /** Inline confirm question, e.g. "Delete all tax records?". */
  confirmPrompt: string;
  /** Confirm button label, e.g. "Yes, delete records". */
  confirmLabel: string;
  /** Number of rows the action would remove; the action is hidden when 0. */
  count: number;
  /** Performs the deletion. */
  run: () => Promise<void>;
}

/**
 * Shared "Danger zone" card for feature pages. Renders one inline-confirm clear
 * button per non-empty action and refreshes the page via `onCleared` afterwards.
 * Renders nothing outside Tauri (no DB) or when every action is empty.
 */
export function DangerZone({
  actions,
  onCleared,
  className = "mt-8",
}: {
  actions: DangerAction[];
  onCleared?: () => void | Promise<void>;
  className?: string;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = actions.filter((a) => a.count > 0);
  if (!isTauri() || visible.length === 0) return null;

  const runClear = async (action: DangerAction) => {
    setBusy(true);
    setError(null);
    try {
      await action.run();
      setConfirming(null);
      await onCleared?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={`border-destructive/40 ${className}`}>
      <CardContent className="space-y-4 py-4">
        <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
        {error && <p className="text-xs text-destructive">{error}</p>}

        {visible.map((a) => (
          <div key={a.id} className="space-y-2">
            <p className="text-xs text-muted-foreground">{a.description}</p>
            {confirming === a.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">{a.confirmPrompt}</span>
                <Button variant="destructive" size="sm" onClick={() => runClear(a)} disabled={busy}>
                  {busy ? "Clearing…" : a.confirmLabel}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirming(a.id)} disabled={busy}>
                <Trash2 className="h-4 w-4" /> {a.label}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
