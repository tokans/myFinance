import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { forgetDocumentPassword, rememberDocumentPassword, type DocumentKind } from "@/lib/documentPasswordVault";

interface Props {
  kind: DocumentKind;
  /** The exact-source identifier this password is keyed to (account name, employer name, PAN, ...). */
  identifier: string;
  /** The password that actually worked. */
  password: string;
  /** Human-readable label stored alongside it (shown if the user ever reviews vault credentials). */
  label: string;
  /** Whether this password is already the one stored for this identifier — skips straight to "saved". */
  alreadyStored: boolean;
}

/**
 * Auto-remembers a password the first time it successfully opens a document
 * for this identifier — no opt-in click needed, so the NEXT document from the
 * same source is tried directly from the vault before the user is ever asked
 * again. "Forget" is the opt-out, in case the user doesn't want it kept.
 */
export function RememberPasswordPrompt({ kind, identifier, password, label, alreadyStored }: Props) {
  const [state, setState] = useState<"saving" | "saved" | "forgotten">(alreadyStored ? "saved" : "saving");

  useEffect(() => {
    setState(alreadyStored ? "saved" : "saving");
    if (alreadyStored || !identifier.trim()) return;
    let cancelled = false;
    void rememberDocumentPassword(kind, identifier, password, label).then(() => {
      if (!cancelled) setState("saved");
    });
    return () => {
      cancelled = true;
    };
  }, [kind, identifier, password, label, alreadyStored]);

  if (!identifier.trim()) return null; // nothing to key vault storage on

  if (state === "forgotten") {
    return <p className="text-xs text-muted-foreground">Forgotten — you'll be asked for the password again next time.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Check className="h-3 w-3 text-emerald-600" />
      <span>{state === "saved" ? "Password remembered for next time." : "Remembering password…"}</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          await forgetDocumentPassword(kind, identifier);
          setState("forgotten");
        }}
      >
        Forget
      </Button>
    </div>
  );
}
