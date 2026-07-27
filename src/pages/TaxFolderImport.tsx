import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, FolderOpen, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { isTauri } from "@/lib/environment";
import { suggestKeyword } from "@/lib/keywordCategoryMatcher";
import {
  classifyFilenameSync, FOLDER_DOC_TYPES, isSupportedFolderDocFile, learnDocKeyword, loadLearnedDocKeywordRules,
  type FolderDocType,
} from "@/tax/folderDocClassifier";
import { useTaxFolderQueueStore, type QueuedDocFile } from "@/stores/taxFolderQueue.store";

const DEFAULT_AY = "2026-27";
const SKIP = "__skip__" as const;
type ChosenType = FolderDocType | typeof SKIP;

interface FolderImportRow {
  file: File;
  detected: FolderDocType | null;
  matchedKeyword: string | null;
  ambiguous: boolean;
  candidates: FolderDocType[];
  chosenType: ChosenType | null;
  rememberKeyword: boolean;
  keywordText: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Bulk document import: scan a whole folder of tax paperwork AND bank/credit
 * card statements, classify each file by filename against the evolving
 * keyword dataset (`tax/folderDocClassifier.ts`), ask the user to clarify
 * anything unmatched/ambiguous, then queue every resolved file through its
 * normal import page one at a time (`hooks/useQueuedDocumentImport.ts` +
 * `stores/taxFolderQueue.store.ts`) — this page only classifies and
 * orchestrates; each existing page's own
 * battle-tested password/review/commit flow does the rest, unchanged.
 */
export function TaxFolderImportPage() {
  const navigate = useNavigate();
  const [ay, setAy] = useState(DEFAULT_AY);
  const [rows, setRows] = useState<FolderImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A plain `<input type="file" webkitdirectory>` used to drive this, but
   * WebView2 doesn't reliably switch its native dialog into folder-picker
   * mode — it can fall back to a normal open-file dialog, which just lets you
   * navigate into folders forever with no way to select one. The native
   * Tauri dialog's `directory: true` mode is the same picker every other
   * desktop-only import page already relies on, and it auto-grants the fs
   * plugin read scope for whatever the user picks (recursively, since we
   * pass `recursive: true`) — see `capabilities/default.json`'s
   * `fs:allow-read-dir` for the command-level permission this needs.
   */
  const handleChooseFolder = async () => {
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, recursive: true });
      if (typeof selected !== "string") return; // cancelled

      setBusy(true);
      const { readDir, readFile } = await import("@tauri-apps/plugin-fs");
      const { join } = await import("@tauri-apps/api/path");

      const filePaths: string[] = [];
      const walk = async (dir: string) => {
        for (const entry of await readDir(dir)) {
          const full = await join(dir, entry.name);
          if (entry.isDirectory) {
            await walk(full);
          } else if (entry.isFile && isSupportedFolderDocFile(entry.name)) {
            filePaths.push(full);
          }
        }
      };
      await walk(selected);

      if (filePaths.length === 0) { setRows([]); return; }

      const learned = await loadLearnedDocKeywordRules();
      const next: FolderImportRow[] = [];
      for (const path of filePaths) {
        const bytes = await readFile(path);
        const name = path.split(/[\\/]/).pop() ?? path;
        const match = classifyFilenameSync(name, learned);
        const confident = match.category && !match.ambiguous;
        next.push({
          file: new File([bytes], name),
          detected: match.category,
          matchedKeyword: match.matchedKeyword,
          ambiguous: match.ambiguous,
          candidates: match.candidates,
          chosenType: confident ? match.category : null,
          rememberKeyword: false,
          keywordText: suggestKeyword(name),
        });
      }
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setChosenType = (index: number, chosenType: ChosenType) => {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, chosenType } : r)));
  };
  const setRememberKeyword = (index: number, rememberKeyword: boolean) => {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, rememberKeyword } : r)));
  };
  const setKeywordText = (index: number, keywordText: string) => {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, keywordText } : r)));
  };

  const unresolvedCount = rows.filter((r) => r.chosenType === null).length;
  const queuedCount = rows.filter((r) => r.chosenType && r.chosenType !== SKIP).length;

  const start = async () => {
    setBusy(true);
    try {
      for (const r of rows) {
        // Only a file that had NO detected match at all gets the "remember
        // this keyword" offer (see the page's UI below) — opt-in, since this
        // reclassifies every future folder scan, not just this one file.
        if (r.rememberKeyword && r.keywordText.trim() && r.chosenType && r.chosenType !== SKIP && !r.detected) {
          await learnDocKeyword(r.keywordText, r.chosenType);
        }
      }
      const queue: QueuedDocFile[] = rows
        .filter((r): r is FolderImportRow & { chosenType: FolderDocType } => !!r.chosenType && r.chosenType !== SKIP)
        .map((r) => ({ file: r.file, docType: r.chosenType }));
      if (queue.length === 0) return;
      useTaxFolderQueueStore.getState().start(queue, ay);
      navigate(FOLDER_DOC_TYPES[queue[0].docType].route);
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-3xl py-6">
        <PageHeader backTo="/tax" backLabel="Back to tax" title="Import a folder of documents" />
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Run in the desktop app to import.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6">
      <PageHeader
        backTo="/tax"
        backLabel="Back to tax"
        title="Import a folder of documents"
        description="Pick the folder where you keep your tax paperwork and bank/credit card statements — every supported file is classified by name and walked through the normal import flow, one at a time."
      />

      <Card className="mb-4">
        <CardContent className="space-y-4 py-6">
          <div className="space-y-1">
            <Label htmlFor="folderAy">Assessment year (applies to every tax document below; ignored for statements)</Label>
            <Input id="folderAy" value={ay} onChange={(e) => setAy(e.target.value)} placeholder="2026-27" />
          </div>

          <div className="space-y-2">
            <Label>Folder</Label>
            <button
              type="button"
              onClick={handleChooseFolder}
              disabled={busy}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FolderOpen className="h-4 w-4" />
              {rows.length > 0 ? `${rows.length} document(s) found` : "Choose a folder"}
            </button>
            <p className="text-xs text-muted-foreground">
              Non-document files (images, OS metadata, etc.) are skipped automatically. Subfolders are scanned too.
            </p>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="flex items-start gap-2 py-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{error}</p>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <FileRow
              key={`${r.file.name}-${i}`}
              row={r}
              onChooseType={(t) => setChosenType(i, t)}
              onRememberChange={(v) => setRememberKeyword(i, v)}
              onKeywordChange={(v) => setKeywordText(i, v)}
            />
          ))}

          <Card className="border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="text-xs text-blue-900 dark:text-blue-200">
                {unresolvedCount > 0
                  ? `${unresolvedCount} file(s) still need a type before you can start.`
                  : `${queuedCount} file(s) will be imported.`}
              </span>
              <Button onClick={start} disabled={busy || unresolvedCount > 0 || queuedCount === 0}>
                <Upload className="h-4 w-4" /> Start
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function FileRow({
  row, onChooseType, onRememberChange, onKeywordChange,
}: {
  row: FolderImportRow;
  onChooseType: (t: ChosenType) => void;
  onRememberChange: (v: boolean) => void;
  onKeywordChange: (v: string) => void;
}) {
  const showRemember = !row.detected && !!row.chosenType && row.chosenType !== SKIP;
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{row.file.name}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(row.file.size)}</p>
          </div>
          <Select value={row.chosenType ?? undefined} onValueChange={(v) => onChooseType(v as ChosenType)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Choose a document type…" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FOLDER_DOC_TYPES) as FolderDocType[]).map((t) => (
                <SelectItem key={t} value={t}>{FOLDER_DOC_TYPES[t].label}</SelectItem>
              ))}
              <SelectItem value={SKIP}>Skip this file</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <StatusBadge row={row} />

        {showRemember && row.chosenType && row.chosenType !== SKIP && (
          <label className="flex items-start gap-2 pt-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={row.rememberKeyword}
              onChange={(e) => onRememberChange(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-input accent-primary"
            />
            <span className="flex flex-wrap items-center gap-1">
              Remember{" "}
              <Input
                value={row.keywordText}
                onChange={(e) => onKeywordChange(e.target.value)}
                className="h-6 w-40 px-1.5 py-0.5 text-xs"
                placeholder="keyword"
              />
              {" "}→ {FOLDER_DOC_TYPES[row.chosenType].label} for future imports?
            </span>
          </label>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ row }: { row: FolderImportRow }) {
  if (row.ambiguous) {
    return (
      <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        Ambiguous — matches {row.candidates.map((c) => FOLDER_DOC_TYPES[c].label).join(", ")}
      </p>
    );
  }
  if (row.detected && row.matchedKeyword) {
    return <p className="text-xs text-muted-foreground">Detected via "{row.matchedKeyword}"</p>;
  }
  if (row.chosenType === SKIP) {
    return <p className="text-xs text-muted-foreground">Skipped</p>;
  }
  return <p className="text-xs text-amber-700 dark:text-amber-400">No match — pick a type</p>;
}
