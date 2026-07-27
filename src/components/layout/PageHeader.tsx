/**
 * PageHeader — the per-page heading + action cluster, rendered into the suite shell's
 * top bar (SuiteShell `topBarCenter`, shown on desktop AND mobile) instead of stacking
 * its own row at the top of the page body. Every page renders exactly one `<PageHeader/>`
 * near the top of its content.
 *
 * Layout:
 *   - **Title** — the top bar's `<h1>`, on both viewports.
 *   - **Actions** — inline buttons on desktop (md+); on mobile they collapse into a
 *     hamburger (☰) that opens a bottom sheet listing them (see `bottom-sheet.tsx`).
 *   - **Back** — on desktop, a back arrow sits inline before the title. On MOBILE the
 *     back arrow is hoisted to the top-left in place of the "myFinance" brand (AppShell
 *     reads the `back` slot from topBar.store), so it is intentionally NOT rendered here
 *     on mobile.
 *   - **Subtitle** (`description`) — always stays in the page body, never the top bar.
 *
 * The injected node is rebuilt each render, so live action state (e.g. a page's
 * select-mode toggle, a wizard's step counter) stays reflected in the top bar.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { usePageTopBar } from "@/stores/topBar.store";

interface PageHeaderProps {
  /** The page title. Shown as the top bar's `<h1>`. */
  title: ReactNode;
  /** Optional one-line subtitle — rendered in the page body only, never in the top bar. */
  description?: ReactNode;
  /** When set, a back arrow (to this route) — inline before the title on desktop, top-left on mobile. */
  backTo?: string;
  /** Accessible label / tooltip for the back arrow. Defaults to "Back". */
  backLabel?: string;
  /** Action buttons — inline on desktop, collapsed into a hamburger bottom-sheet on mobile. */
  actions?: ReactNode;
  /** Extra classes for the in-body subtitle wrapper (e.g. margin overrides). */
  className?: string;
}

export function PageHeader({ title, description, backTo, backLabel, actions, className }: PageHeaderProps) {
  const bar = (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {/* Desktop-only inline back arrow. On mobile the back arrow replaces the brand
            (rendered by AppShell from the topBar.store `back` slot). */}
        {backTo && (
          <Link
            to={backTo}
            aria-label={backLabel ?? "Back"}
            title={backLabel ?? "Back"}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
      </div>
      {actions && (
        <>
          {/* Desktop: inline action buttons. */}
          <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div>
          {/* Mobile: the same actions, collapsed into a hamburger → bottom sheet. */}
          <ActionsMenu title={typeof title === "string" ? title : "Actions"}>{actions}</ActionsMenu>
        </>
      )}
    </div>
  );
  usePageTopBar(bar, backTo ? { to: backTo, label: backLabel } : null);

  // Body render is the subtitle only (the title + actions live in the top bar on both
  // viewports). When there is no subtitle, render nothing.
  if (!description) return null;
  return (
    <div className={cn("mb-6", className)}>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/** Mobile-only hamburger that opens a bottom sheet listing the page's actions (stacked full-width). */
function ActionsMenu({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Actions"
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>
      <BottomSheet open={open} onOpenChange={setOpen} title={title}>
        {/* Stack each action full-width; a click anywhere dismisses the sheet. */}
        <div
          className="flex flex-col gap-2 px-2 pb-2 [&>*]:w-full [&>*]:justify-center"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      </BottomSheet>
    </div>
  );
}
