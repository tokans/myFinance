import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LifeBuoy, Phone, Mail, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/openExternal";
import { EMERGENCY_DISCLAIMER, mailtoHref, telHref } from "@/lib/emergency";

interface EmergencyAccount {
  name: string;
  contact: string | null;
  emergency_action: string | null;
}

/**
 * The "Press during Emergency" action. Shows a button that opens a focused
 * dialog with the account's saved action note, contact, and one-tap call/email.
 * The required disclaimer is always visible before any action is taken — the
 * app never verifies these details and they may be out of date.
 *
 * Rendered only where there's something to act on (an action note or a contact);
 * callers should gate on that, but it also self-guards.
 */
export function EmergencyActionButton({
  account,
  className,
  size = "default",
}: {
  account: EmergencyAccount;
  className?: string;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const tel = telHref(account.contact);
  const mailto = mailtoHref(account.contact);

  if (!account.emergency_action?.trim() && !account.contact?.trim()) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="destructive"
          size={size}
          className={className}
        >
          <LifeBuoy className="h-4 w-4" /> Press during Emergency
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-destructive/10 p-2 text-destructive">
              <LifeBuoy className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-lg font-semibold tracking-tight">
                Emergency steps — {account.name}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                Saved instructions for this account.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </Dialog.Close>
          </div>

          {account.emergency_action?.trim() && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What to do
              </p>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
                {account.emergency_action}
              </p>
            </div>
          )}

          {account.contact?.trim() && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contact
              </p>
              <p className="text-sm">{account.contact}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {tel && (
                  <Button size="sm" onClick={() => void openExternal(tel)}>
                    <Phone className="h-4 w-4" /> Call now
                  </Button>
                )}
                {mailto && (
                  <Button size="sm" variant="outline" onClick={() => void openExternal(mailto)}>
                    <Mail className="h-4 w-4" /> Email
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/50 p-3 text-[11px] leading-snug text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{EMERGENCY_DISCLAIMER}</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
