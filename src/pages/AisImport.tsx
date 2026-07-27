import { paymentRowLabel } from "@/tax/taxLabels";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, AlertCircle, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/PageHeader";
import { isTauri } from "@/lib/environment";
import { useSettingsStore } from "@/stores/settings.store";
import { formatMoney } from "@/lib/format";
import { decryptAisFile } from "@/tax/aisCrypto";
import { parseAisJson, type AisParseResult } from "@/tax/aisParser";
import { clearRowsBySourcePrefix, insertIncome, insertPayment, upsertTaxYear } from "@/db/tax";
import { replaceSftForAy } from "@/db/aisSft";

type Stage = "idle" | "review" | "done";

const DEFAULT_AY = "2026-27";

/**
 * Import an AIS/TIS statement downloaded from the Income-Tax portal. The file is
 * encrypted; we decrypt it in-app with the filer's PAN + date of birth (see
 * aisCrypto.ts), parse it (aisParser.ts), then let the user review before
 * writing income/TDS rows into the assessment year.
 */
export function AisImportPage() {
  const navigate = useNavigate();
  const currency = useSettingsStore((s) => s.settings.currency);
  const [stage, setStage] = useState<Stage>("idle");
  const [fileText, setFileText] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [pan, setPan] = useState("");
  const [dob, setDob] = useState("");
  const [password, setPassword] = useState("");
  const [parsed, setParsed] = useState<AisParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    try {
      setFileText(await f.text());
      setFilename(f.name);
      // Prefill PAN from the conventional "<PAN>_<FY>_AIS_<date>.json" filename.
      const m = f.name.match(/([A-Z]{5}\d{4}[A-Z])/i);
      if (m && !pan) setPan(m[1].toUpperCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const decrypt = async () => {
    if (!fileText) { setError("Choose your AIS JSON file first."); return; }
    setBusy(true);
    setError(null);
    try {
      const json = await decryptAisFile(fileText, { pan, dob, password: password || undefined });
      const r = parseAisJson(json);
      setParsed(r);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const ay = parsed.ay ?? DEFAULT_AY;
      await upsertTaxYear(ay, { imported_filename: filename });
      await clearRowsBySourcePrefix(ay, "AIS:");
      for (const r of parsed.income) await insertIncome({ ...r, ay, note: "From AIS", excluded: false });
      for (const r of parsed.payments) await insertPayment({ ...r, ay, note: "From AIS" });
      await replaceSftForAy(ay, parsed.sft);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-2xl py-6">
        <PageHeader backTo="/tax" backLabel="Back to tax" title="Import AIS / TIS" />
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Run in the desktop app to decrypt and import.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo="/tax"
        backLabel="Back to tax"
        title="Import AIS / TIS"
        description="Decrypt the Annual Information Statement JSON you downloaded from the Income-Tax portal and prefill your income and TDS. Decryption happens entirely on this device — nothing is uploaded."
      />

      <Card className="mb-4 border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
        <CardContent className="flex items-start gap-2 py-3 text-xs text-blue-900 dark:text-blue-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            AIS reflects third-party reports and can be incomplete or need correction. Treat the extracted
            figures as a starting point and verify against your own records.
          </span>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {stage === "idle" && (
        <Card>
          <CardContent className="space-y-4 py-6">
            <div className="space-y-2">
              <Label htmlFor="aisfile">AIS JSON file</Label>
              <Label
                htmlFor="aisfile"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground hover:border-primary/50"
              >
                <Upload className="h-4 w-4" />
                {filename ? <span className="font-medium text-foreground">{filename}</span> : "Choose the encrypted AIS .json"}
                <input id="aisfile" type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
              </Label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="pan">PAN</Label>
                <Input id="pan" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dob">Date of birth</Label>
                <Input id="dob" value={dob} onChange={(e) => setDob(e.target.value)} placeholder="DDMMYYYY" />
              </div>
            </div>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Decryption failed? Enter the password manually</summary>
              <div className="mt-2 space-y-1">
                <Label htmlFor="aispw">Password</Label>
                <Input id="aispw" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="AIS file password" />
              </div>
            </details>

            <div className="flex justify-end">
              <Button onClick={decrypt} disabled={busy || !fileText}>
                {busy ? "Decrypting…" : "Decrypt & preview"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "review" && parsed && (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Check className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">Decrypted</span>
              <span className="text-muted-foreground">·</span>
              <span>AY <strong>{parsed.ay ?? "(unknown)"}</strong></span>
              <span className="text-muted-foreground">·</span>
              <span>{parsed.recordCount} record(s) read</span>
              {(parsed.unmappedCount > 0 || parsed.unnamedPayerCount > 0) && (
                <span className="ml-auto flex items-center gap-2">
                  {parsed.unmappedCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                      <AlertCircle className="h-3 w-3" /> {parsed.unmappedCount} unmapped
                    </span>
                  )}
                  {parsed.unnamedPayerCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                      <AlertCircle className="h-3 w-3" /> {parsed.unnamedPayerCount} unnamed payer(s)
                    </span>
                  )}
                </span>
              )}
            </CardContent>
          </Card>

          <Section title={`Income (${parsed.income.length})`}>
            {parsed.income.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">None extracted.</p>
            ) : (
              <Table rows={parsed.income.map((r) => [r.label, r.head, r.amount])} currency={currency} />
            )}
          </Section>

          <Section title={`TDS / TCS (${parsed.payments.length})`}>
            {parsed.payments.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">None extracted.</p>
            ) : (
              <Table rows={parsed.payments.map((r) => [paymentRowLabel(r).label, r.type, r.amount])} currency={currency} />
            )}
          </Section>

          <Section title={`SFT — Statement of Financial Transaction (${parsed.sft.length})`}>
            {parsed.sft.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">None extracted.</p>
            ) : (
              <>
                <p className="px-4 pt-3 text-xs text-muted-foreground">
                  Large-value transactions reported to the tax department — kept separate from your income above
                  (summing both would double-count). Saved so you can cross-check them against your bank ledger.
                </p>
                <Table rows={parsed.sft.map((r) => [r.description, r.sftCode, r.amount])} currency={currency} />
              </>
            )}
          </Section>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStage("idle")} disabled={busy}>Back</Button>
            <Button onClick={commit} disabled={busy || (parsed.income.length === 0 && parsed.payments.length === 0)}>
              {busy ? "Saving…" : "Save to tax records"}
            </Button>
          </div>
        </div>
      )}

      {stage === "done" && parsed && (
        <Card>
          <CardContent className="space-y-3 py-6">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-emerald-100 p-1 dark:bg-emerald-950">
                <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold">Imported AIS into AY {parsed.ay ?? DEFAULT_AY}</h3>
            </div>
            <ul className="text-sm text-muted-foreground">
              <li>{parsed.income.length} income line(s)</li>
              <li>{parsed.payments.length} TDS/TCS line(s)</li>
              <li>{parsed.sft.length} SFT record(s) saved for cross-check</li>
            </ul>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => navigate(`/tax/${encodeURIComponent(parsed.ay ?? DEFAULT_AY)}`)}>
                Open AY {parsed.ay ?? DEFAULT_AY}
              </Button>
              {parsed.sft.length > 0 && (
                <Button variant="outline" onClick={() => navigate(`/tax/${encodeURIComponent(parsed.ay ?? DEFAULT_AY)}/sft`)}>
                  Review SFT cross-check
                </Button>
              )}
              <Button variant="ghost" onClick={() => { setStage("idle"); setParsed(null); }}>
                Import another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-2 text-sm font-medium">{title}</div>
        {children}
      </CardContent>
    </Card>
  );
}

function Table({ rows, currency }: { rows: [string, string, number][]; currency: string }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t first:border-t-0">
            <td className="px-4 py-1.5">{r[0]}</td>
            <td className="px-4 py-1.5 text-xs text-muted-foreground">{r[1]}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{formatMoney(r[2], currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
