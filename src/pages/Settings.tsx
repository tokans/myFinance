import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Lock } from "lucide-react";
import { useSettingsStore } from "@/stores/settings.store";
import { useGatingStore } from "@/stores/gating.store";
import { FEATURE_GATES } from "@/lib/featureGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FiniteSetInput } from "@/components/forms/FiniteSetInput";
import { UnlockPanel } from "@/components/vault/UnlockPanel";
import { DangerZone } from "@/components/common/DangerZone";
import { isTauri } from "@/lib/environment";
import { currencyForCountry } from "@/lib/countryCurrency";
import { clearAllData, countAllData } from "@/db/maintenance";
import { buildExcelBackup, saveBackupFile } from "@/lib/excelBackup";
import { BackupPanel } from "sharedcorelib/ui";
import type { ExcelBackup } from "sharedcorelib/backup";
import type { DateFormat, FyStartMonth } from "@/db/settings";

const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY  —  31/03/2026" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY  —  03/31/2026" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD  —  2026-03-31" },
];

export function SettingsPage() {
  const { settings, loaded, update } = useSettingsStore();
  const syncUnlocked = useGatingStore((s) => FEATURE_GATES.sync.isUnlocked(s));
  const refreshGating = useGatingStore((s) => s.refresh);
  const [dataCount, setDataCount] = useState(0);
  const [backup, setBackup] = useState<ExcelBackup | null>(null);

  const refreshDataCount = useCallback(async () => {
    if (!isTauri()) return;
    try { setDataCount(await countAllData()); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refreshGating();
    void refreshDataCount();
    if (isTauri()) {
      buildExcelBackup().then(setBackup).catch((e) => console.warn("excel backup unavailable:", e));
    }
  }, [refreshGating, refreshDataCount]);

  if (!loaded) {
    return <div className="container py-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="container max-w-2xl py-6">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Defaults applied across the app.</p>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Running in the browser without Tauri. Settings won&apos;t persist — start the desktop app
            with <code className="rounded bg-amber-200/40 px-1">npm run tauri:dev</code> to save to disk.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Currency, financial year, date format.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <FiniteSetInput
              id="currency"
              masterId="currency"
              value={settings.currency}
              onChange={(v) => update({ currency: v })}
            />
            <p className="text-xs text-muted-foreground">
              Set automatically from your country of residence — change it here to override.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fy">Financial year starts</Label>
            <Select
              value={String(settings.fyStartMonth)}
              onValueChange={(v) => update({ fyStartMonth: Number(v) as FyStartMonth })}
            >
              <SelectTrigger id="fy" data-testid="settings-fy-trigger"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem data-testid="settings-fy-jan" value="1">January (calendar year)</SelectItem>
                <SelectItem data-testid="settings-fy-apr" value="4">April (India FY)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dfmt">Default date format</Label>
            <Select
              value={settings.dateFormat}
              onValueChange={(v) => update({ dateFormat: v as DateFormat })}
            >
              <SelectTrigger id="dfmt"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_FORMATS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used as the parsing hint default during Excel import.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="theme">Theme</Label>
            <Select
              value={settings.theme}
              onValueChange={(v) => update({ theme: v as "system" | "light" | "dark" })}
            >
              <SelectTrigger id="theme"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Where you live — used for context across the app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="residence-country">Country of residence</Label>
            <FiniteSetInput
              id="residence-country"
              masterId="country"
              value={settings.residenceCountry}
              onChange={(v) => {
                const linked = currencyForCountry(v);
                update({
                  residenceCountry: v,
                  residenceCity: "",
                  ...(linked ? { currency: linked } : {}),
                });
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="residence-city">City of residence</Label>
            <FiniteSetInput
              id="residence-city"
              masterId="city"
              parentValue={settings.residenceCountry || null}
              value={settings.residenceCity}
              onChange={(v) => update({ residenceCity: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Sync &amp; devices</CardTitle>
          <CardDescription>
            Merge data with another device over your local Wi-Fi — no server, nothing uploaded.
            {!syncUnlocked && " An Expert-tier feature."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/sync">
              {syncUnlocked ? <RefreshCw className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
              Open device sync
            </Link>
          </Button>
        </CardContent>
      </Card>

      {isTauri() && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Backup &amp; restore</CardTitle>
            <CardDescription>
              Export everything — including this app&apos;s shared-suite tables — to one Excel
              workbook, or restore one on a new machine. Secrets export as hashes, never in the clear.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {backup ? (
              <BackupPanel
                backup={backup}
                save={saveBackupFile}
                onImported={() => { void refreshDataCount(); void refreshGating(); }}
                className="border-0 bg-transparent p-0"
              />
            ) : (
              <p className="text-xs text-muted-foreground">Preparing backup engine…</p>
            )}
          </CardContent>
        </Card>
      )}

      {isTauri() && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Credential vault
          </h3>
          <UnlockPanel />
        </div>
      )}

      <DangerZone
        onCleared={async () => { await refreshDataCount(); await refreshGating(); }}
        actions={[
          {
            id: "all",
            label: "Clear all data",
            description: (
              <>
                <span className="font-medium text-foreground">Clear all data</span> — wipes every record
                across the whole app: accounts and monthly values, tax, goals, people, the entire estate
                suite and reminders ({dataCount} row{dataCount === 1 ? "" : "s"} in total). Your settings
                and the credential vault are kept. This cannot be undone.
              </>
            ),
            confirmPrompt: "Delete ALL data in the app?",
            confirmLabel: "Yes, delete everything",
            count: dataCount,
            run: clearAllData,
          },
        ]}
      />
    </div>
  );
}
