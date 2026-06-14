import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A mobile bottom sheet built on Radix Dialog — slides up from the bottom edge
 * and respects the device safe-area inset. Used by the mobile nav to host the
 * secondary navigation groups that no longer fit in the 3-button tab bar.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 md:hidden" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border-t bg-background pb-[var(--safe-bottom,env(safe-area-inset-bottom))] shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:fade-in-0 md:hidden",
            className,
          )}
        >
          {/* Grab handle */}
          <div className="flex justify-center pt-2.5">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <div className="flex items-start gap-3 px-4 pb-3 pt-2">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-base font-semibold tracking-tight">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="text-xs text-muted-foreground">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
