import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Upload, AlertCircle, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/PageHeader";
import type { DocModel } from "@scandoc/core/docmodel";
import { ParsedDocumentPanel } from "@/components/documents/ParsedDocumentPanel";
import { ParsingLogPanel } from "@/components/documents/ParsingLogPanel";
import { RememberPasswordPrompt } from "@/components/documents/RememberPasswordPrompt";
import { isTauri } from "@/lib/environment";
import { candidatesWithStoredPassword, type DocumentKind } from "@/lib/documentPasswordVault";
import { writeDebugDump } from "@/lib/debugDump";
import type { ParseLogEntry } from "@/lib/parseLog";
import { describeShape, learnPatternIfNew } from "@/statements/passwordPatternLearning";
import { clearRowsBySourcePrefix, insertIncome, insertPayment, upsertTaxYear, type TaxIncomeRow, type TaxPaymentRow } from "@/db/tax";
import { replaceRefundsForAy, type TaxRefundRow } from "@/db/taxRefunds";
import { replaceSftForAy } from "@/db/aisSft";
import { capturedOf } from "@/tax/reviewCapture";
import { DocumentPasswordRequiredError } from "@/statements/types";
import { loadTaxProfile } from "@/tax/taxProfile";
import { aisPdfToIncomeRows, aisPdfToPaymentRows, aisPdfToRefundRows, aisPdfToSftRows, previewAisPdf, type AisPdfParseResult, type AisPdfSftRow } from "@/tax/aisPdf";
import { tisPdfToIncomeRows, tisPdfToPaymentRows, tisPdfToRefundRows, previewTisPdf, type TisPdfParseResult } from "@/tax/tisPdf";
import { useQueuedDocumentImport } from "@/hooks/useQueuedDocumentImport";
import type { FolderDocType } from "@/tax/folderDocClassifier";

type Stage = "idle" | "review" | "done";
export type CategoryDocumentVariant = "ais" | "tis";

const DEFAULT_AY = "2026-27";

interface VariantConfig {
  title: string;
  vaultKind: DocumentKind;
  sourcePrefix: string;
  /** Kind tag for the reviewed-YAML debug dump, matching the raw-parse dump
   *  each preview function already writes (`tax/aisPdf.ts`/`tax/tisPdf.ts`). */
  debugKind: string;
  preview: (bytes: Uint8Array, filename: string, candidates: string[]) => Promise<{
    result: AisPdfParseResult | TisPdfParseResult;
    model: DocModel;
    passwordUsed: string | null;
    log: ParseLogEntry[];
  }>;
  toIncome: (result: AisPdfParseResult | TisPdfParseResult, ay: string) => Omit<TaxIncomeRow, "id">[];
  /** Part B3 advance-tax challans — empty array if the document has none. */
  toPayments: (result: AisPdfParseResult | TisPdfParseResult, ay: string) => Omit<TaxPaymentRow, "id">[];
  /** Part B4 refunds — empty array if the document has none. */
  toRefunds: (result: AisPdfParseResult | TisPdfParseResult, ay: string) => Omit<TaxRefundRow, "id">[];
  /** Part B2 (SFT) source entries → the SFT cross-check table
   *  (`myfinance_ais_sft`) — only AIS-PDF has this (TIS's equivalent
   *  Annexure section isn't parsed, see `categoryAmountPdf.ts`'s
   *  `findSummarySectionEnd`); omitted for TIS so `commit()` below never
   *  touches that table on a TIS import (there's exactly one producer per
   *  AY — see `db/aisSft.ts` — and it isn't TIS). */
  toSft?: (result: AisPdfParseResult | TisPdfParseResult, ay: string) => AisPdfSftRow[];
}

const VARIANTS: Record<CategoryDocumentVariant, VariantConfig> = {
  ais: {
    title: "Import AIS PDF",
    vaultKind: "ais",
    sourcePrefix: "AIS-PDF",
    debugKind: "ais-pdf",
    preview: previewAisPdf,
    toIncome: aisPdfToIncomeRows as VariantConfig["toIncome"],
    toPayments: aisPdfToPaymentRows as VariantConfig["toPayments"],
    toRefunds: aisPdfToRefundRows as VariantConfig["toRefunds"],
    toSft: aisPdfToSftRows as VariantConfig["toSft"],
  },
  tis: {
    title: "Import TIS PDF",
    vaultKind: "tis",
    sourcePrefix: "TIS-PDF",
    debugKind: "tis-pdf",
    preview: previewTisPdf,
    toIncome: tisPdfToIncomeRows as VariantConfig["toIncome"],
    toPayments: tisPdfToPaymentRows as VariantConfig["toPayments"],
    toRefunds: tisPdfToRefundRows as VariantConfig["toRefunds"],
  },
};

/** Shared page for the AIS/TIS PDF summary exports (per-category amount
 *  table) — a lighter, less precise read than the AIS Utility's structured
 *  JSON already handled by `tax/ais` (`AisImportPage`). */
export function CategoryDocumentImportPage({ variant }: { variant: CategoryDocumentVariant }) {
  const cfg = VARIANTS[variant];
  const navigate = useNavigate();
  const [ay, setAy] = useState(DEFAULT_AY);
  const [stage, setStage] = useState<Stage>("idle");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [filename, setFilename] = useState("");
  const [pan, setPan] = useState("");
  const [dob, setDob] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [parsed, setParsed] = useState<AisPdfParseResult | TisPdfParseResult | null>(null);
  const [model, setModel] = useState<DocModel | null>(null);
  const [passwordUsed, setPasswordUsed] = useState<string | null>(null);
  const [alreadyStoredPassword, setAlreadyStoredPassword] = useState<string | null>(null);
  const [learnedPattern, setLearnedPattern] = useState<string | null>(null);
  const [log, setLog] = useState<ParseLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<ParseLogEntry[]>([]);
  const [manualPwOpen, setManualPwOpen] = useState(false);
  const expectedDocType: FolderDocType = variant === "ais" ? "ais_pdf" : "tis_pdf";
  const queue = useQueuedDocumentImport(expectedDocType);

  // PAN/DOB/name are never re-typed here — they're pulled from the tax filer
  // profile purely to derive password-guess candidates.
  useEffect(() => {
    void loadTaxProfile().then((profile) => {
      setPan(profile.pan);
      setDob(profile.dob);
      setName(profile.name);
    });
  }, []);

  // Bulk-folder-import hand-off — see Form16ImportPage's identical effect for
  // why this loads the profile itself rather than depending on the effect above.
  useEffect(() => {
    if (!queue.pendingFile) return;
    const file = queue.pendingFile;
    let cancelled = false;
    void (async () => {
      const profile = await loadTaxProfile();
      if (cancelled) return;
      setPan(profile.pan);
      setDob(profile.dob);
      setName(profile.name);
      setAy(queue.pendingAy ?? DEFAULT_AY);
      const b = new Uint8Array(await file.arrayBuffer());
      if (cancelled) return;
      setBytes(b);
      setFilename(file.name);
      await parse({ bytes: b, filename: file.name, pan: profile.pan, dob: profile.dob, name: profile.name });
    })();
    return () => { cancelled = true; };
  }, [queue.pendingFile]);

  const handleFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setErrorLog([]);
    setBytes(new Uint8Array(await f.arrayBuffer()));
    setFilename(f.name);
  };

  const parse = async (override?: { bytes?: Uint8Array; filename?: string; pan?: string; dob?: string; name?: string }) => {
    const b = override?.bytes ?? bytes;
    const fn = override?.filename ?? filename;
    const effPan = override?.pan ?? pan;
    const effDob = override?.dob ?? dob;
    const effName = override?.name ?? name;
    if (!b) { setError("Choose your PDF first."); return; }
    setBusy(true);
    setError(null);
    setErrorLog([]);
    setLearnedPattern(null);
    try {
      const candidates = await candidatesWithStoredPassword(cfg.vaultKind, effPan, { pan: effPan, dob: effDob, name: effName, password: password || undefined });
      setAlreadyStoredPassword(candidates[0] ?? null);
      const { result, model: parsedModel, passwordUsed: pw, log: logEntries } = await cfg.preview(b, fn ?? "", candidates);
      setParsed(result);
      setModel(parsedModel);
      setPasswordUsed(pw);
      setLog(logEntries);
      setStage("review");
      if (pw) {
        const shape = await learnPatternIfNew(pw, { pan: effPan, dob: effDob, name: effName });
        if (shape) setLearnedPattern(describeShape(shape));
      }
    } catch (err) {
      if (err instanceof DocumentPasswordRequiredError) {
        setError(`${err.message} Enter the password manually below, or update your PAN/date of birth in your tax filer profile if they've changed.`);
        setErrorLog(err.log);
        setManualPwOpen(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      void writeDebugDump(`${cfg.debugKind}-reviewed`, { filename, processed: parsed.rows });
      await upsertTaxYear(ay, { imported_filename: filename });
      await clearRowsBySourcePrefix(ay, cfg.sourcePrefix);
      for (const r of cfg.toIncome(parsed, ay)) await insertIncome(r);
      for (const p of cfg.toPayments(parsed, ay)) await insertPayment(p);
      await replaceRefundsForAy(
        ay,
        cfg.sourcePrefix,
        cfg.toRefunds(parsed, ay).map((r) => ({ amount: r.amount, mode: r.mode, refundDate: r.refund_date, sourcePath: r.source_path ?? cfg.sourcePrefix, note: r.note })),
      );
      if (cfg.toSft) await replaceSftForAy(ay, cfg.toSft(parsed, ay));
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
        <PageHeader backTo="/tax" backLabel="Back to tax" title={cfg.title} />
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Run in the desktop app to parse documents natively.
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
        title={cfg.title}
        description="Parsing happens entirely on this device — nothing is uploaded."
      />

      <Card className="mb-4 border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
        <CardContent className="flex items-start gap-2 py-3 text-xs text-blue-900 dark:text-blue-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This is a lighter, less precise read than importing the AIS Utility's JSON export directly
            (see "Import AIS/TIS" on the Tax page) — category labels vary more in the PDF layout, so
            review every row before saving.
          </span>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="space-y-2 py-3 text-xs text-destructive">
            <p>{error}</p>
            {errorLog.length > 0 && (
              <div className="text-foreground">
                <ParsingLogPanel entries={errorLog} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {stage === "idle" && (
        <Card>
          <CardContent className="space-y-4 py-6">
            <div className="space-y-1">
              <Label htmlFor="catAy">Assessment year</Label>
              <Input id="catAy" value={ay} onChange={(e) => setAy(e.target.value)} placeholder="2026-27" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="catfile">{cfg.title} document</Label>
              <Label
                htmlFor="catfile"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground hover:border-primary/50"
              >
                <Upload className="h-4 w-4" />
                {filename ? <span className="font-medium text-foreground">{filename}</span> : "Choose the .pdf/.zip"}
                <input
                  id="catfile"
                  type="file"
                  accept=".pdf,.zip,application/pdf,application/zip"
                  className="hidden"
                  onChange={handleFile}
                />
              </Label>
            </div>

            <p className="text-xs text-muted-foreground">
              We try common password patterns built from your PAN, date of birth, and name on file (your
              tax filer profile) plus any password remembered from an earlier import, before asking you to
              type the exact password.
            </p>

            {!pan && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Add your PAN and date of birth in your{" "}
                <Link to={`/tax/${encodeURIComponent(ay)}/return`} className="underline">tax filer profile</Link>{" "}
                to enable automatic password matching.
              </p>
            )}

            <details open={manualPwOpen} onToggle={(e) => setManualPwOpen(e.currentTarget.open)} className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Decryption failed? Enter the password manually</summary>
              <div className="mt-2 space-y-1">
                <Label htmlFor="catPw">Password</Label>
                <Input id="catPw" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Document password" />
              </div>
            </details>

            <div className="flex justify-end">
              <Button onClick={() => parse()} disabled={busy || !bytes}>
                {busy ? "Parsing…" : "Parse & preview"}
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
              <span className="font-medium">Parsed</span>
              <span className="text-muted-foreground">·</span>
              <span>{parsed.rows.length} categor{parsed.rows.length === 1 ? "y" : "ies"} read</span>
              {parsed.paymentRows.length > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span>{parsed.paymentRows.length} tax payment{parsed.paymentRows.length === 1 ? "" : "s"} (Part B3)</span>
                </>
              )}
              {parsed.refundRows.length > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span>{parsed.refundRows.length} refund{parsed.refundRows.length === 1 ? "" : "s"} (Part B4)</span>
                </>
              )}
            </CardContent>
          </Card>

          {passwordUsed && (
            <RememberPasswordPrompt
              kind={cfg.vaultKind}
              identifier={pan}
              password={passwordUsed}
              label={pan ? `PAN ${pan}` : cfg.title}
              alreadyStored={passwordUsed === alreadyStoredPassword}
            />
          )}

          {learnedPattern && (
            <p className="text-xs text-muted-foreground">
              Recognized password pattern: <span className="font-medium text-foreground">{learnedPattern}</span> —
              we'll try this automatically for other tax documents too.
            </p>
          )}

          {parsed.warnings.length > 0 && (
            <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
              <CardContent className="space-y-1 py-3 text-xs text-amber-900 dark:text-amber-200">
                {parsed.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {model && <ParsedDocumentPanel model={model} capturedData={capturedOf(parsed)} />}

          <ParsingLogPanel entries={log} />

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStage("idle")} disabled={busy}>Back</Button>
            <Button onClick={commit} disabled={busy || parsed.rows.length === 0}>
              {busy ? "Saving…" : "Save to tax records"}
            </Button>
          </div>
        </div>
      )}

      {stage === "done" && (
        <Card>
          <CardContent className="space-y-3 py-6">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-emerald-100 p-1 dark:bg-emerald-950">
                <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold">Imported into AY {ay}</h3>
            </div>
            {queue.hasNext ? (
              <div className="flex gap-2 pt-2">
                <Button onClick={() => queue.goToNextInQueue(ay)}>
                  Next file ({(queue.queuePosition ?? 0) + 1} of {queue.queueTotal})
                </Button>
              </div>
            ) : (
              <>
                {queue.queueTotal && queue.queueTotal > 1 && (
                  <p className="text-xs text-muted-foreground">Last of {queue.queueTotal} documents from your folder import.</p>
                )}
                <div className="flex gap-2 pt-2">
                  <Button onClick={() => navigate(`/tax/${encodeURIComponent(ay)}`)}>Open AY {ay}</Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setStage("idle");
                      setBytes(null);
                      setFilename("");
                      setParsed(null);
                      setModel(null);
                    }}
                  >
                    Import another
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
