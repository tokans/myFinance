import { Link } from "react-router-dom";
import { Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { FeatureGate } from "@/lib/featureGate";

/**
 * Full-screen locked state for a progressively-unlocked feature. Rendered in
 * place of the page's real content until its prerequisite is met. Tells the user
 * exactly how to unlock it and links them straight to where they can do it.
 *
 * Pass `onCtaClick` to handle the unlock in place (e.g. open a popup form)
 * instead of navigating to `gate.ctaTo`.
 */
export function LockedFeature({
  gate,
  onCtaClick,
}: {
  gate: FeatureGate;
  onCtaClick?: () => void;
}) {
  return (
    <div className="container max-w-2xl py-16">
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
          <div className="rounded-full bg-muted p-4 text-muted-foreground">
            <Lock className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">{gate.lockedTitle}</h2>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">{gate.unlockHint}</p>
          </div>
          {onCtaClick ? (
            <Button data-testid="locked-cta" onClick={onCtaClick}>
              {gate.ctaLabel} <ArrowRight className="h-4 w-4" />
            </Button>
          ) : gate.ctaTo ? (
            <Button asChild>
              <Link data-testid="locked-cta" to={gate.ctaTo}>
                {gate.ctaLabel} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
