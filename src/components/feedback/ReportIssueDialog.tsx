import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bug, ExternalLink, Github, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { openExternal } from "@/lib/openExternal";
import { selectTier, useTierStore } from "@/stores/tier.store";
import {
  buildIssueUrl,
  collectContext,
  ISSUE_TYPES,
  type IssueType,
} from "@/lib/reportIssue";

export function ReportIssueDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [type, setType] = useState<IssueType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);

  const tier = useTierStore(selectTier);
  const refreshTier = useTierStore((s) => s.refresh);
  const tierLoaded = useTierStore((s) => s.loaded);

  // Gather app/system context and ensure the tier is resolved when the dialog opens.
  useEffect(() => {
    if (open) {
      void collectContext().then(setContext);
      if (!tierLoaded) void refreshTier();
    }
  }, [open, tierLoaded, refreshTier]);

  // Reset the form whenever the dialog is reopened.
  useEffect(() => {
    if (open) {
      setType("bug");
      setTitle("");
      setDescription("");
      setSteps("");
      setIncludeContext(true);
      setBusy(false);
    }
  }, [open]);

  const canSubmit = title.trim().length > 0 && description.trim().length > 0;

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const url = buildIssueUrl(
        { type, title, description, steps, includeContext, tierLabel: tier.label },
        context,
      );
      await openExternal(url);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <Bug className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold tracking-tight">
                Report an issue
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                This opens a prefilled issue on GitHub. You&apos;ll be asked to sign in
                (or sign up) with GitHub to submit it.
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
              <Label htmlFor="issue-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as IssueType)}>
                <SelectTrigger id="issue-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="issue-title">Title</Label>
              <Input
                id="issue-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="A short summary"
                autoFocus
                maxLength={120}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="issue-desc">Description</Label>
              <Textarea
                id="issue-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  type === "bug"
                    ? "What happened? What did you expect instead?"
                    : "Describe your idea or question in detail."
                }
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Your report will start with “I am {/^[aeiou]/i.test(tier.label) ? "an" : "a"}{" "}
                {tier.label} user…” so we know your usage level.
              </p>
            </div>

            {type === "bug" && (
              <div className="space-y-1.5">
                <Label htmlFor="issue-steps">Steps to reproduce (optional)</Label>
                <Textarea
                  id="issue-steps"
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  placeholder={"1. Go to…\n2. Click…\n3. See error"}
                  rows={3}
                />
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              />
              <span>
                Include app version and system info — helps with debugging. No personal
                or financial data is included.
              </span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={!canSubmit || busy} className="gap-2">
                <Github className="h-4 w-4" />
                {busy ? "Opening…" : "Continue on GitHub"}
                <ExternalLink className="h-3.5 w-3.5 opacity-80" />
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
