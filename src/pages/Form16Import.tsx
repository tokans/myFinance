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
import { candidatesWithStoredPassword } from "@/lib/documentPasswordVault";
import { writeDebugDump } from "@/lib/debugDump";
import type { ParseLogEntry } from "@/lib/parseLog";
import { describeShape, learnPatternIfNew } from "@/statements/passwordPatternLearning";
import { clearRowsBySourcePrefix, insertDeduction, insertIncome, insertPayment, upsertTaxYear } from "@/db/tax";
import { DocumentPasswordRequiredError } from "@/statements/types";
import { checkDocumentIdentity, type DocumentIdentityCheck } from "@/tax/documentIdentityCheck";
import { loadTaxProfile } from "@/tax/taxProfile";
import { form16ToDeductionRows, form16ToIncomeRows, form16ToPaymentRows, previewForm16, type Form16ParseResult } from "@/tax/form16";
import { useQueuedDocumentImport } from "@/hooks/useQueuedDocumentImport";

type Stage = "idle" | "review" | "done";

const DEFAULT_AY = "2026-27";

/**
 * Imports a Form 16 "TDS Certificate". Its own dedicated page (not the
 * shared `TdsDocumentImportPage`) because its data model — header metadata,
 * a quarterly TDS table, a per-challan tax-deposit ledger, and Part B's
 * numbered salary/deduction/tax-computation line items — is a comprehensive,
 * nested capture of the WHOLE document, not a flat deductor-row list like
 * Form 26AS. See `tax/form16.ts`'s doc comment.
 */
export function Form16ImportPage() {
  const navigate = useNavigate();
  const [ay, setAy] = useState(DEFAULT_AY);
  const [stage, setStage] = useState<Stage>("idle");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [filename, setFilename] = useState("");
  const [identifier, setIdentifier] = useState(""); // employer name, for the password vault key
  const [pan, setPan] = useState("");
  const [dob, setDob] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [parsedResult, setParsedResult] = useState<Form16ParseResult | null>(null);
  const [model, setModel] = useState<DocModel | null>(null);
  const [identity, setIdentity] = useState<DocumentIdentityCheck | null>(null);
  const [passwordUsed, setPasswordUsed] = useState<string | null>(null);
  const [alreadyStoredPassword, setAlreadyStoredPassword] = useState<string | null>(null);
  const [learnedPattern, setLearnedPattern] = useState<string | null>(null);
  const [log, setLog] = useState<ParseLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<ParseLogEntry[]>([]);
  const [manualPwOpen, setManualPwOpen] = useState(false);
  const queue = useQueuedDocumentImport("form16");

  useEffect(() => {
    void loadTaxProfile().then((profile) => {
      setPan(profile.pan);
      setDob(profile.dob);
      setName(profile.name);
    });
  }, []);

  // Bulk-folder-import hand-off: a queued file auto-runs the same parse flow
  // a manual pick would, instead of waiting for `handleFile`. Loads the
  // profile itself (redundant with the effect above, but cheap) rather than
  // relying on that effect's state having landed yet — there's no guaranteed
  // ordering between two independent effects.
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
      const effAy = queue.pendingAy ?? DEFAULT_AY;
      setAy(effAy);
      const b = new Uint8Array(await file.arrayBuffer());
      if (cancelled) return;
      setBytes(b);
      setFilename(file.name);
      await parse({ bytes: b, filename: file.name, pan: profile.pan, dob: profile.dob, name: profile.name, ay: effAy });
    })();
    return () => { cancelled = true; };
    // `parse`/`queue.pendingAy` intentionally excluded: `parse` is stable enough
    // in practice here and re-running on every render would defeat the
    // once-per-consumed-file intent; only `queue.pendingFile` should retrigger this.
  }, [queue.pendingFile]);

  const handleFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setErrorLog([]);
    setBytes(new Uint8Array(await f.arrayBuffer()));
    setFilename(f.name);
  };

  const parse = async (override?: { bytes?: Uint8Array; filename?: string; pan?: string; dob?: string; name?: string; ay?: string }) => {
    const b = override?.bytes ?? bytes;
    const fn = override?.filename ?? filename;
    const effPan = override?.pan ?? pan;
    const effDob = override?.dob ?? dob;
    const effName = override?.name ?? name;
    const effAy = override?.ay ?? ay;
    if (!b) { setError("Choose your Form 16 document first."); return; }
    setBusy(true);
    setError(null);
    setErrorLog([]);
    setLearnedPattern(null);
    try {
      const candidates = await candidatesWithStoredPassword("form16", identifier, {
        pan: effPan,
        dob: effDob,
        name: effName,
        password: password || undefined,
      });
      setAlreadyStoredPassword(candidates[0] ?? null);
      const { result, model: docModel, passwordUsed: pw, log: logEntries } = await previewForm16(b, fn ?? "", candidates);
      setModel(docModel);
      setParsedResult(result);
      const idCheck = checkDocumentIdentity({
        detectedAy: result.header.assessmentYear,
        detectedPan: result.header.employeePan,
        currentAy: effAy,
        defaultAy: DEFAULT_AY,
        profilePan: effPan,
      });
      setIdentity(idCheck);
      if (idCheck.ayAutoFilled) setAy(idCheck.effectiveAy);
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
    if (!parsedResult) return;
    setBusy(true);
    setError(null);
    try {
      void writeDebugDump("form16-reviewed", { filename, processed: parsedResult });
      await upsertTaxYear(ay, { imported_filename: filename });
      await clearRowsBySourcePrefix(ay, "Form16-PDF");
      for (const p of form16ToPaymentRows(parsedResult, ay)) await insertPayment(p);
      for (const r of form16ToIncomeRows(parsedResult, ay)) await insertIncome(r);
      for (const r of form16ToDeductionRows(parsedResult, ay)) await insertDeduction(r);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const useDetectedAy = () => {
    if (!identity?.ayMismatch) return;
    setAy(identity.ayMismatch.detected);
    setIdentity({ ...identity, ayMismatch: null });
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-2xl py-6">
        <PageHeader backTo="/tax" backLabel="Back to tax" title="Import Form 16" />
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Run in the desktop app to parse documents natively.
          </CardContent>
        </Card>
      </div>
    );
  }

  const quarterlyTaxDeducted = parsedResult?.quarters.reduce((sum, q) => sum + (q.taxDeducted ?? 0), 0) ?? 0;
  const incomeToSave = parsedResult ? form16ToIncomeRows(parsedResult, ay) : [];
  const deductionToSave = parsedResult ? form16ToDeductionRows(parsedResult, ay) : [];
  const savedBits = [`quarterly TDS total (₹${quarterlyTaxDeducted.toLocaleString("en-IN")})`];
  if (incomeToSave.length > 0) savedBits.push(`salary income (₹${incomeToSave[0].amount.toLocaleString("en-IN")}, Part B item 6)`);
  if (deductionToSave.length > 0) {
    savedBits.push(`Chapter VI-A: ${deductionToSave.map((d) => `${d.section} ₹${d.amount.toLocaleString("en-IN")}`).join(", ")}`);
  }

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo="/tax"
        backLabel="Back to tax"
        title="Import Form 16"
        description="Parsing happens entirely on this device — nothing is uploaded."
      />

      <Card className="mb-4 border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
        <CardContent className="flex items-start gap-2 py-3 text-xs text-blue-900 dark:text-blue-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The whole document is captured below (header, quarterly TDS, tax deposits, Part B's salary/tax
            computation) for your review. The quarterly TDS total, the Part B salary figure (item 6), and
            any Chapter VI-A deduction sections we can confidently identify are saved to your tax records —
            everything else in Part B is reference only.
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
              <Label htmlFor="f16Ay">Assessment year</Label>
              <Input id="f16Ay" value={ay} onChange={(e) => setAy(e.target.value)} placeholder="2026-27" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="f16file">Form 16 document</Label>
              <Label
                htmlFor="f16file"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground hover:border-primary/50"
              >
                <Upload className="h-4 w-4" />
                {filename ? <span className="font-medium text-foreground">{filename}</span> : "Choose the Form 16 document"}
                <input id="f16file" type="file" accept=".pdf,.zip,.xlsx,.xls,application/pdf,application/zip" className="hidden" onChange={handleFile} />
              </Label>
            </div>

            <div className="space-y-1">
              <Label htmlFor="f16Identifier">Employer name</Label>
              <Input id="f16Identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. ACME Corp Pvt Ltd" />
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
                <Label htmlFor="f16Pw">Password</Label>
                <Input id="f16Pw" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Document password" />
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

      {stage === "review" && parsedResult && (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Check className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">Parsed</span>
              <span className="text-muted-foreground">·</span>
              <span>{parsedResult.quarters.length} quarter(s), {parsedResult.taxDeposits.length} deposit(s), {parsedResult.partB.length} Part B item(s)</span>
            </CardContent>
          </Card>

          {identity?.ayMismatch && (
            <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
              <CardContent className="flex flex-wrap items-center gap-2 py-3 text-xs text-amber-900 dark:text-amber-200">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  This document's Assessment Year looks like <strong>{identity.ayMismatch.detected}</strong>, but
                  you're importing into AY {identity.ayMismatch.current}.
                </span>
                <Button size="sm" variant="outline" className="ml-auto" onClick={useDetectedAy}>
                  Use {identity.ayMismatch.detected}
                </Button>
              </CardContent>
            </Card>
          )}

          {identity?.panMismatch && (
            <Card className="border-destructive/60">
              <CardContent className="flex items-start gap-2 py-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  This document's PAN (<strong>{identity.panMismatch.detected}</strong>) doesn't match your tax
                  filer profile's PAN ({identity.panMismatch.expected}) — make sure you selected the right file.
                </span>
              </CardContent>
            </Card>
          )}

          {passwordUsed && (
            <RememberPasswordPrompt
              kind="form16"
              identifier={identifier}
              password={passwordUsed}
              label={identifier || "Form 16"}
              alreadyStored={passwordUsed === alreadyStoredPassword}
            />
          )}

          {learnedPattern && (
            <p className="text-xs text-muted-foreground">
              Recognized password pattern: <span className="font-medium text-foreground">{learnedPattern}</span> —
              we'll try this automatically for other tax documents too.
            </p>
          )}

          {parsedResult.warnings.length > 0 && (
            <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
              <CardContent className="space-y-1 py-3 text-xs text-amber-900 dark:text-amber-200">
                {parsedResult.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="py-3 text-xs text-muted-foreground">
              Saved to your tax records: {savedBits.join(" · ")}. Everything else in Part B (shown below) is
              reference only — add it manually in the return builder.
            </CardContent>
          </Card>

          {model && (
            <ParsedDocumentPanel
              model={model}
              capturedData={{ header: parsedResult.header, quarters: parsedResult.quarters, taxDeposits: parsedResult.taxDeposits, partB: parsedResult.partB }}
            />
          )}

          <ParsingLogPanel entries={log} />

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStage("idle")} disabled={busy}>Back</Button>
            <Button onClick={commit} disabled={busy}>
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
                      setParsedResult(null);
                      setIdentity(null);
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
