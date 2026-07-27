import * as Dialog from "@radix-ui/react-dialog";
import { Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnlockPanel } from "./UnlockPanel";
import { useVaultPromptStore } from "@/stores/vaultPrompt.store";

/**
 * Global popup that appears when a locked vault blocks something the user
 * is in the middle of (e.g. document-import password lookup) instead of
 * just surfacing an error message — see `ensureVaultUnlocked` in
 * `vaultPrompt.store.ts`. Mounted once in AppShell alongside the other
 * global dialogs.
 */
export function VaultUnlockDialog() {
  const open = useVaultPromptStore((s) => s.open);
  const settle = useVaultPromptStore((s) => s.settle);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) settle(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <Lock className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold tracking-tight">Unlock credential vault</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                Needed to check for a saved document password. You can also close this and type the
                password manually instead.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </Dialog.Close>
          </div>

          <UnlockPanel className="border-0 bg-transparent p-0 shadow-none" onUnlocked={() => settle(true)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
