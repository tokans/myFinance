import type { ParseLogEntry } from "@/lib/parseLog";

/** Collapsed-by-default "what happened during parsing" panel — always available
 *  (no separate debug-mode toggle needed) so a bad parse can be reviewed
 *  in-place. Renders nothing when there's nothing to show. */
export function ParsingLogPanel({ entries }: { entries: ParseLogEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">Parsing log ({entries.length} step{entries.length === 1 ? "" : "s"})</summary>
      <ol className="mt-2 space-y-1 pl-4">
        {entries.map((e, i) => (
          <li key={i} className="list-decimal">
            <span className="font-medium text-foreground">{e.stage}:</span> {e.detail}
          </li>
        ))}
      </ol>
    </details>
  );
}
