import { useState } from "react";
import { Download, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isTauri } from "@/lib/environment";
import { buildExportWorkbook, defaultFilename } from "@/excel/export";

export function ExportPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ path: string; sheets: number; rows: number } | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const wb = await buildExportWorkbook();
      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        const path = await save({
          defaultPath: defaultFilename(),
          filters: [{ name: "Excel", extensions: ["xlsx"] }],
        });
        if (!path) {
          setBusy(false);
          return;
        }
        await writeFile(path, wb.data);
        setDone({ path, sheets: wb.sheetCount, rows: wb.rowCount });
      } else {
        // Browser fallback — trigger download
        const blob = new Blob([wb.data.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultFilename();
        a.click();
        URL.revokeObjectURL(url);
        setDone({ path: "downloaded via browser", sheets: wb.sheetCount, rows: wb.rowCount });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container max-w-2xl py-6">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Export Excel</h2>
        <p className="text-sm text-muted-foreground">
          One sheet per month (newest first), col A = account name, col B = value. Re-import without questions.
        </p>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Browser mode will trigger a download but the data comes from the in-memory DB only (which is empty).
            For a real export, use the desktop app.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {done ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-emerald-100 p-1 dark:bg-emerald-950">
                <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold">Exported</h3>
            </div>
            <p className="text-sm">
              <strong>{done.sheets}</strong> sheet{done.sheets === 1 ? "" : "s"} · <strong>{done.rows}</strong> row{done.rows === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-muted-foreground break-all">{done.path}</p>
            <Button variant="outline" size="sm" onClick={() => setDone(null)}>Export again</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <Download className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm">
              Save all monthly snapshots to a single .xlsx file.
            </p>
            <Button onClick={handleExport} disabled={busy}>
              {busy ? "Building workbook…" : "Export now"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
