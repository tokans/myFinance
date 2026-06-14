import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LIFE_GOAL_TEMPLATES,
  spriteTileStyle,
  type LifeGoalTemplate,
} from "@/domain/lifeGoals";
import { addCustomOption } from "@/db/customOptions";

export interface TemplatePick {
  name: string;
  /** Sensible starting target; null when the template is open-ended ("Others"). */
  targetAmount: number | null;
  category: string;
}

/**
 * Visual gallery of life-goal templates (form-manifests/goals.yaml →
 * life_goal_templates). Each tile is a slice of public/img/life-goals.png.
 * Clicking a tile pre-fills a new goal; the "Others" tile first prompts for
 * a custom description.
 */
export function LifeGoalPicker({ onPick }: { onPick: (pick: TemplatePick) => void }) {
  const [customFor, setCustomFor] = useState<LifeGoalTemplate | null>(null);
  const [customName, setCustomName] = useState("");

  const choose = (t: LifeGoalTemplate) => {
    if (t.custom) {
      setCustomFor(t);
      setCustomName("");
      return;
    }
    onPick({ name: t.label, targetAmount: t.defaultTarget, category: t.value });
  };

  const submitCustom = () => {
    const name = customName.trim();
    if (!name || !customFor) return;
    // Grow the life-goal master so this user-defined label can resurface later
    // (best-effort; no-op outside Tauri). Mirrors the "Other adds to master" rule.
    void addCustomOption("life_goal", name, name);
    onPick({ name, targetAmount: customFor.defaultTarget, category: customFor.value });
    setCustomFor(null);
    setCustomName("");
  };

  return (
    <div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {LIFE_GOAL_TEMPLATES.map((t) => (
          <li key={t.value}>
            <button
              type="button"
              onClick={() => choose(t)}
              title={t.hint}
              className="group flex w-full flex-col items-center gap-1.5 rounded-lg border border-transparent p-1.5 text-center transition hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className="relative aspect-square w-full overflow-hidden rounded-md bg-muted ring-1 ring-border/50 transition group-hover:ring-border"
                style={spriteTileStyle(t.spriteIndex)}
              >
                {t.custom && (
                  <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <Plus className="h-1/3 w-1/3" />
                  </span>
                )}
              </span>
              <span className="text-[11px] font-medium leading-tight">{t.label}</span>
            </button>
          </li>
        ))}
      </ul>

      {customFor && (
        <div className="mt-3 space-y-2 rounded-lg border bg-card p-3">
          <Label htmlFor="lg-custom">Describe your goal</Label>
          <div className="flex gap-2">
            <Input
              id="lg-custom"
              autoFocus
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitCustom();
                }
              }}
              maxLength={64}
              placeholder="e.g. Sabbatical year, music studio, …"
            />
            <Button type="button" onClick={submitCustom} disabled={!customName.trim()}>
              Continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCustomFor(null);
                setCustomName("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
