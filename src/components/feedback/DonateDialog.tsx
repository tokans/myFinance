import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Heart, ExternalLink, Mail, FolderDown, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openDonatePage } from "@/lib/donate";
import { PATRON_FILE_NAME } from "@/lib/patronFile";
import { useTierStore } from "@/stores/tier.store";

/**
 * "Become a Patron" flow. Opens the hosted donation page, then explains how
 * Patron status is confirmed: tokans.org emails a file which the user saves to
 * their Downloads folder, and the app loads it on the next launch. There is no
 * in-app payment confirmation (the app has no backend) — opening the page just
 * flips the shell button to "Restart after Donation".
 */
export function DonateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const markOpenedDonation = useTierStore((s) => s.markOpenedDonation);
  const [busy, setBusy] = useState(false);

  const handleDonate = async () => {
    setBusy(true);
    try {
      await openDonatePage();
      await markOpenedDonation();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400">
              <Heart className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold tracking-tight">
                Become a Patron
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                myFinance is free and runs entirely on your device. A donation
                keeps it going — and unlocks the Patron tier.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </Dialog.Close>
          </div>

          <div className="space-y-2.5 text-sm text-muted-foreground">
            <Step icon={Heart} n={1}>
              Donate on our secure page (opens in your browser).
            </Step>
            <Step icon={Mail} n={2}>
              We email you a Patron file once the payment is confirmed.
            </Step>
            <Step icon={FolderDown} n={3}>
              Save it to your <strong>Downloads</strong> folder, keeping the name{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{PATRON_FILE_NAME}</code>.
            </Step>
            <Step icon={RotateCw} n={4}>
              Restart the app — it loads the file and lights up your Patron tier.
            </Step>
          </div>

          <Button onClick={handleDonate} disabled={busy} className="gap-2">
            <Heart className="h-4 w-4" />
            {busy ? "Opening…" : "Donate"}
            <ExternalLink className="h-3.5 w-3.5 opacity-80" />
          </Button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Step({
  icon: Icon,
  n,
  children,
}: {
  icon: typeof Heart;
  n: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground">
        {n}
      </span>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
      <span>{children}</span>
    </div>
  );
}
