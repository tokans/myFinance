import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Upload, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/PageHeader";
import { ParsingLogPanel } from "@/components/documents/ParsingLogPanel";
import { RememberPasswordPrompt } from "@/components/documents/RememberPasswordPrompt";
import { isTauri } from "@/lib/environment";
import { candidatesWithStoredPassword } from "@/lib/documentPasswordVault";
import type { ParseLogEntry } from "@/lib/parseLog";
import { describeShape, learnPatternIfNew } from "@/statements/passwordPatternLearning";
import { DocumentPasswordRequiredError } from "@/statements/types";
import { loadTaxProfile } from "@/tax/taxProfile";
import { commitItReturn, previewItReturn } from "@/tax/itReturnImport";
import { useQueuedDocumentImport } from "@/hooks/useQueuedDocumentImport";

type Stage = "idle" | "review" | "done";

const DEFAULT_AY = "2026-27";

/**
 * Import an IT-Return document (ITR-V acknowledgment, intimation order, or
 * similar e-filing portal PDF). No figures are extracted or fed into tax
 * computation — this only verifies the password and stores the document
 * securely alongside the app's other encrypted attachments.
 */
export function ItReturnImportPage() {
  const navigate = useNavigate();
  const [ay, setAy] = useState(DEFAULT_AY);
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [filename, setFilename] = useState("");
  const [pan, setPan] = useState("");
  const [dob, setDob] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordUsed, setPasswordUsed] = useState<string | null>(null);
  const [alreadyStoredPassword, setAlreadyStoredPassword] = useState<string | null>(null);
  const [learnedPattern, setLearnedPattern] = useState<string | null>(null);
  const [log, setLog] = useState<ParseLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<ParseLogEntry[]>([]);
  const [manualPwOpen, setManualPwOpen] = useState(false);
  const queue = useQueuedDocumentImport("it_return");

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
      setTitle((t) => t || file.name.replace(/\.[^.]+$/, ""));
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
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const parse = async (override?: { bytes?: Uint8Array; filename?: string; pan?: string; dob?: string; name?: string }) => {
    const b = override?.bytes ?? bytes;
    const fn = override?.filename ?? filename;
    const effPan = override?.pan ?? pan;
    const effDob = override?.dob ?? dob;
    const effName = override?.name ?? name;
    if (!b) { setError("Choose your IT-return document first."); return; }
    setBusy(true);
    setError(null);
    setErrorLog([]);
    setLearnedPattern(null);
    try {
      const candidates = await candidatesWithStoredPassword("it_return", effPan, { pan: effPan, dob: effDob, name: effName, password: password || undefined });
      setAlreadyStoredPassword(candidates[0] ?? null);
      const { passwordUsed: pw, log: logEntries } = await previewItReturn(b, fn ?? "", candidates);
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
    if (!bytes) return;
    setBusy(true);
    setError(null);
    try {
      await commitItReturn(bytes, title.trim() || filename, ay);
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
        <PageHeader backTo="/tax" backLabel="Back to tax" title="Import IT-Return document" />
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
        title="Import IT-Return document"
        description="ITR-V acknowledgment, intimation order, or similar. Stored as an encrypted attachment — no figures are extracted or used in tax computation."
      />

      <Card className="mb-4 border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
        <CardContent className="flex items-start gap-2 py-3 text-xs text-blue-900 dark:text-blue-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>These documents vary too much in layout to parse reliably — this only verifies the password and keeps a secure copy for your records.</span>
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
              <Label htmlFor="itAy">Assessment year</Label>
              <Input id="itAy" value={ay} onChange={(e) => setAy(e.target.value)} placeholder="2026-27" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="itfile">Document</Label>
              <Label
                htmlFor="itfile"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground hover:border-primary/50"
              >
                <Upload className="h-4 w-4" />
                {filename ? <span className="font-medium text-foreground">{filename}</span> : "Choose the .pdf/.zip"}
                <input
                  id="itfile"
                  type="file"
                  accept=".pdf,.zip,application/pdf,application/zip"
                  className="hidden"
                  onChange={handleFile}
                />
              </Label>
            </div>

            <div className="space-y-1">
              <Label htmlFor="itTitle">Title</Label>
              <Input id="itTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ITR-V acknowledgment" />
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
                <Label htmlFor="itPw">Password</Label>
                <Input id="itPw" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Document password" />
              </div>
            </details>

            <div className="flex justify-end">
              <Button onClick={() => parse()} disabled={busy || !bytes}>
                {busy ? "Verifying…" : "Verify & preview"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "review" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Check className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">Verified — ready to store</span>
              <span className="text-muted-foreground">·</span>
              <span>{title || filename}</span>
            </CardContent>
          </Card>

          {passwordUsed && (
            <RememberPasswordPrompt
              kind="it_return"
              identifier={pan}
              password={passwordUsed}
              label={pan ? `PAN ${pan}` : "IT-Return"}
              alreadyStored={passwordUsed === alreadyStoredPassword}
            />
          )}

          {learnedPattern && (
            <p className="text-xs text-muted-foreground">
              Recognized password pattern: <span className="font-medium text-foreground">{learnedPattern}</span> —
              we'll try this automatically for other tax documents too.
            </p>
          )}

          <ParsingLogPanel entries={log} />

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStage("idle")} disabled={busy}>Back</Button>
            <Button onClick={commit} disabled={busy}>
              {busy ? "Saving…" : "Save as attachment"}
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
              <h3 className="text-base font-semibold">Document stored</h3>
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
                  <Button onClick={() => navigate("/tax")}>Back to tax</Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setStage("idle");
                      setBytes(null);
                      setFilename("");
                      setTitle("");
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
