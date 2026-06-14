import { useState } from "react";
import { Download, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isTauri } from "@/lib/environment";
import { demoSaveName } from "@/lib/demoMode";
import { buildExportWorkbook, defaultFilename } from "@/excel/export";

/**
 * One-click Excel export, surfaced on the Dashboard (the Export screen was
 * removed from navigation). Writes via the native save dialog in the desktop
 * app and falls back to a browser download in dev. Self-contained: busy and
 * done states live here so it can drop into any header.
 */
export function ExportButton() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    setDone(false);
    try {
      const wb = await buildExportWorkbook();
      if (isTauri()) {
        const { writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
        // Demo mode: skip the native save dialog and write under the app-data
        // dir (an allowed fs scope) so recordings run unattended.
        const demoName = demoSaveName(defaultFilename());
        if (demoName) {
          await writeFile(demoName, wb.data, { baseDir: BaseDirectory.AppData });
        } else {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const path = await save({
            defaultPath: defaultFilename(),
            filters: [{ name: "Excel", extensions: ["xlsx"] }],
          });
          if (!path) return; // user cancelled
          await writeFile(path, wb.data);
        }
      } else {
        const blob = new Blob([wb.data.buffer as ArrayBuffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultFilename();
        a.click();
        URL.revokeObjectURL(url);
      }
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button data-testid="dashboard-export-button" variant="outline" size="sm" onClick={handleExport} disabled={busy}>
      {done ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
      {busy ? "Exporting…" : done ? "Exported" : "Export"}
    </Button>
  );
}
