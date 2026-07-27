import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown in place of a desktop-only feature (the transaction ledger — statement
 * PDF/xlsx parsing already only bundles PDFium on desktop, and reconciliation/
 * categorization inherit that same constraint) when running on mobile.
 * Mirrors the existing `!isTauri()` amber-notice convention used elsewhere
 * (e.g. Form16Import.tsx, AccountDetail.tsx) rather than a hard block/redirect.
 */
export function DesktopOnlyNotice({ feature = "This feature" }: { feature?: string }) {
  return (
    <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
      <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
        {feature} is available on the desktop app only — use the desktop app to manage transactions.
      </CardContent>
    </Card>
  );
}
