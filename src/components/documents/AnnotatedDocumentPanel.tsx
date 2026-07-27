import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AnnotatedCell, AnnotatedRow } from "@/statements/annotate";

const INITIAL_ROW_LIMIT = 150;

/** Renders a scalar the way a human-readable YAML value would look: bare if
 *  it's a simple token, double-quoted (with internal quotes escaped) if it
 *  contains anything YAML-significant or is empty. */
function formatScalar(text: string): string {
  if (text === "" || /[:"'#\n]|^\s|\s$/.test(text)) {
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return text;
}

function Cell({ cell }: { cell: AnnotatedCell }) {
  if (cell.field !== null) {
    return (
      <div className="whitespace-pre-wrap break-words text-foreground">
        <span className="text-muted-foreground">{cell.field}:</span> {formatScalar(cell.text)}
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap break-words text-amber-700 dark:text-amber-400">
      ~ {formatScalar(cell.text)}
    </div>
  );
}

function Row({ row }: { row: AnnotatedRow }) {
  return (
    <div className="border-t py-1.5 pl-4 first:border-t-0">
      {row.cells.map((cell, i) => (
        <Cell key={i} cell={cell} />
      ))}
    </div>
  );
}

/**
 * Replaces the old raw-table fallback: shows the FULL geometry-reconstructed
 * document — every page, every row, every cell — as read-only YAML-flavored
 * text, always (not just when the specific-field classifier found nothing).
 * Recognized cells render as `field: "value"` in normal text; cells no
 * classifier claimed render as a bare `~ "value"` line in amber — this
 * app's existing "needs your attention" color (see e.g. `Insurance.tsx`,
 * `Liquidity.tsx`) — so recognized vs unrecognized content is visibly
 * distinguishable in one unified view instead of a separate fallback grid.
 */
export function AnnotatedDocumentPanel({ rows }: { rows: AnnotatedRow[] }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const visible = expanded ? rows : rows.slice(0, INITIAL_ROW_LIMIT);
  const truncated = rows.length > visible.length;

  let currentPage: number | null = null;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-2 text-sm font-medium">
          Parsed document ({rows.length} row{rows.length === 1 ? "" : "s"}) — recognized fields in normal
          text, unmatched content in <span className="text-amber-700 dark:text-amber-400">amber</span>
        </div>
        <div className="max-h-[32rem] overflow-auto px-4 py-2 font-mono text-xs leading-relaxed">
          {visible.map((row, i) => {
            const pageHeader = row.pageIndex !== currentPage;
            currentPage = row.pageIndex;
            return (
              <div key={i}>
                {pageHeader && (
                  <div className="pt-2 text-muted-foreground first:pt-0">page {row.pageIndex}:</div>
                )}
                <Row row={row} />
              </div>
            );
          })}
        </div>
        {truncated && (
          <div className="border-t px-4 py-2">
            <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
              Show all {rows.length} rows
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
