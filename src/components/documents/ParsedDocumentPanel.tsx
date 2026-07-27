import { useMemo, useState } from "react";
import { stringify } from "yaml";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DocModel, DocNode } from "@scandoc/core/docmodel";

const INITIAL_LINE_LIMIT = 200;

/**
 * Shows the whole document as the parser understood it — sections, tables
 * keyed by their own headers, key/value blocks, and any text that belonged to
 * neither — as read-only YAML. When `capturedData` is given, every value
 * that made it into the data actually being saved is highlighted green/bold
 * in place, with a hover tooltip naming the field it was captured as — this
 * is the review screen's only view of the captured data (there is no
 * separate editable copy), so a bad match has to be visible here.
 *
 * This replaces `AnnotatedDocumentPanel`'s per-cell view, and the difference
 * is the point. That panel could only show a flat list of reconstructed cells
 * tagged with which field a classifier claimed, because a flat list of cells
 * was all the pipeline had. Showing the structure instead answers the
 * question a user actually has when a figure looks wrong — "did it read the
 * table the way I read it?" — rather than "which cells were recognized".
 *
 * `ref` is stripped: it points back into the interim geometry for the
 * diagnostic dump, and is noise to a human reviewing content.
 */
function stripRefs(node: DocNode): unknown {
  switch (node.kind) {
    case "section":
      return { section: node.title, children: node.children.map(stripRefs) };
    case "table":
      return {
        table: node.headers,
        rows: node.records.map((r) => ({
          ...r.cells,
          ...(r.unmatched?.length ? { "~unmatched": r.unmatched } : {}),
          ...(r.children?.length ? { "~nested": r.children.map(stripRefs) } : {}),
        })),
      };
    case "properties":
      return {
        properties: node.entries.map((e) => ({
          [e.key || "(unlabelled)"]: e.extras?.length ? [e.value, ...e.extras] : e.value,
          ...(e.children?.length ? { "~nested": e.children.map(stripRefs) } : {}),
        })),
      };
    case "text":
      return { text: node.text };
  }
}

interface CapturedLeaf {
  value: string | number;
  label: string;
}

/** Turns a captured-data object/array into a flat list of primitive leaves,
 *  each with a human-readable label for the field it came from — e.g. the
 *  `balance` of the 2nd record in an array becomes `{ value: 15234.5, label:
 *  "#2 → balance" }`. */
function flattenCaptured(node: unknown, path: (string | number)[] = []): CapturedLeaf[] {
  if (node === null || node === undefined) return [];
  if (typeof node === "string" || typeof node === "number") {
    if (path.length === 0 || node === "") return [];
    return [{ value: node, label: humanizePath(path) }];
  }
  if (typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap((v, i) => flattenCaptured(v, [...path, i]));
  if (typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => flattenCaptured(v, [...path, k]));
  }
  return [];
}

function humanizePath(path: (string | number)[]): string {
  return path
    .map((seg) => (typeof seg === "number" ? `#${seg + 1}` : seg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()))
    .join(" → ");
}

interface HighlightRegion {
  start: number;
  end: number;
  labels: Set<string>;
}

/** Finds spans in one rendered line that correspond to a captured value —
 *  numbers by parsed equality (the source document's own formatting varies:
 *  commas, currency symbols, trailing zeros), everything else by
 *  case-insensitive substring. Best-effort only: this is a review aid, not a
 *  source of truth, so an occasional missed or over-eager match is an
 *  acceptable trade for not needing a field-by-field extraction trace. */
function findHighlightRegions(line: string, leaves: CapturedLeaf[]): HighlightRegion[] {
  const regions: HighlightRegion[] = [];

  const numericLeaves = leaves.filter((l): l is { value: number; label: string } => typeof l.value === "number");
  if (numericLeaves.length > 0) {
    const numberToken = /-?\d[\d,]*(?:\.\d+)?/g;
    let m: RegExpExecArray | null;
    while ((m = numberToken.exec(line))) {
      const parsed = Number(m[0].replace(/,/g, ""));
      if (Number.isNaN(parsed)) continue;
      const matched = numericLeaves.filter((l) => Math.abs(l.value - parsed) < 0.005);
      if (matched.length > 0) {
        regions.push({ start: m.index, end: m.index + m[0].length, labels: new Set(matched.map((l) => l.label)) });
      }
    }
  }

  const stringLeaves = leaves.filter((l): l is { value: string; label: string } => typeof l.value === "string" && l.value.trim().length >= 2);
  const lower = line.toLowerCase();
  for (const leaf of stringLeaves) {
    const needle = leaf.value.trim().toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx >= 0) regions.push({ start: idx, end: idx + needle.length, labels: new Set([leaf.label]) });
  }

  if (regions.length === 0) return regions;
  regions.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HighlightRegion[] = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) {
      last.end = Math.max(last.end, r.end);
      r.labels.forEach((l) => last.labels.add(l));
    } else {
      merged.push({ start: r.start, end: r.end, labels: new Set(r.labels) });
    }
  }
  return merged;
}

function renderLine(line: string, leaves: CapturedLeaf[]) {
  const regions = leaves.length > 0 ? findHighlightRegions(line, leaves) : [];
  if (regions.length === 0) return line;
  const nodes: (string | JSX.Element)[] = [];
  let cursor = 0;
  regions.forEach((r, i) => {
    if (r.start > cursor) nodes.push(line.slice(cursor, r.start));
    nodes.push(
      <span
        key={i}
        title={`Used for: ${[...r.labels].join(", ")}`}
        className="cursor-help font-bold text-green-700 underline decoration-dotted underline-offset-2 dark:text-green-400"
      >
        {line.slice(r.start, r.end)}
      </span>,
    );
    cursor = r.end;
  });
  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}

export function ParsedDocumentPanel({ model, capturedData }: { model: DocModel; capturedData?: unknown }) {
  const [expanded, setExpanded] = useState(false);

  const yaml = useMemo(() => {
    try {
      return stringify(model.children.map(stripRefs), { indent: 2, lineWidth: 0 });
    } catch {
      // A review panel must never be the thing that breaks the import screen.
      return "(could not render the parsed document)";
    }
  }, [model]);

  const leaves = useMemo(() => (capturedData !== undefined ? flattenCaptured(capturedData) : []), [capturedData]);

  if (model.children.length === 0) return null;

  const lines = yaml.split("\n");
  const visible = expanded ? lines : lines.slice(0, INITIAL_LINE_LIMIT);
  const truncated = lines.length > visible.length;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">Parsed document</h3>
          <span className="text-xs text-muted-foreground">
            {model.source.filename} · {model.source.pages} page{model.source.pages === 1 ? "" : "s"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {leaves.length > 0 ? (
            <>
              Everything the parser read, as structure. Values in{" "}
              <span className="font-bold text-green-700 dark:text-green-400">green bold</span> are what will be
              saved — hover one to see which field it was captured as.
            </>
          ) : (
            "Everything the parser read, as structure. Nothing here is imported on its own — check that the tables and figures below match the original document."
          )}
        </p>
        {model.warnings.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">
            {model.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs leading-relaxed">
          {visible.map((line, i) => (
            <span key={i}>
              {renderLine(line, leaves)}
              {i < visible.length - 1 ? "\n" : ""}
            </span>
          ))}
          {truncated ? "\n…" : ""}
        </pre>
        {truncated && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Show all {lines.length} lines
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
