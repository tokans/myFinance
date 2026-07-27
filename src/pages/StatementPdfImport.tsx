import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Upload, AlertCircle, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { ParsedDocumentPanel } from "@/components/documents/ParsedDocumentPanel";
import { ParsingLogPanel } from "@/components/documents/ParsingLogPanel";
import { RememberPasswordPrompt } from "@/components/documents/RememberPasswordPrompt";
import { isTauri } from "@/lib/environment";
import { useSettingsStore } from "@/stores/settings.store";
import { candidatesWithStoredPassword } from "@/lib/documentPasswordVault";
import { writeDebugDump } from "@/lib/debugDump";
import type { ParseLogEntry } from "@/lib/parseLog";
import { learnPatternIfNew } from "@/statements/passwordPatternLearning";
import { DocumentPasswordRequiredError } from "@/statements/types";
import { commitPdfStatement, previewPdfStatement, type PdfStatementCommitResult } from "@/statements/pdfStatementImport";
import type { StatementPreview } from "@/statements/types";
import { listAccounts, type Account } from "@/db/accounts";
import { loadTaxProfile } from "@/tax/taxProfile";
import { useQueuedDocumentImport } from "@/hooks/useQueuedDocumentImport";

type Stage = "idle" | "review" | "done";

/** Sentinel Select value for "this isn't one of my existing accounts". */
const NEW_ACCOUNT_VALUE = "__new__";

/**
 * Import a bank/credit-card statement — PDF, password-protected ZIP, or
 * xlsx/xls. Parsing is entirely native/on-device (sharedCoreLib/pdf-lib +
 * officecrypto-tool) — nothing is uploaded. Because a statement is
 * transaction-level and myFinance's data model is monthly snapshots, this
 * writes one month-end balance snapshot per month the statement covers (via
 * the same commit pipeline the Excel importer uses), rather than a
 * per-transaction ledger.
 *
 * The account is chosen from a dropdown of existing accounts (or "Other" to
 * create a new one, same as the Excel importer's name-matching) rather than
 * typed freehand every time. PAN/DOB/name for password guessing come
 * silently from the tax filer profile (same source Form16 import uses) and
 * the account-specific customer ID comes from the selected account's own
 * record (`Account.customer_id`, set once on the Accounts page) — so repeat
 * imports for an account with these already set never need a manual password.
 *
 * Also reachable as a `bank_statement` stop in `TaxFolderImportPage`'s bulk
 * folder-import queue (`useQueuedDocumentImport`) — the one queue target
 * outside `/tax/*`. Unlike those pages, a queued hand-off only prefills the
 * file; it can't auto-run `parse()` like the tax pages do, since the account
 * a statement belongs to isn't something the folder scan can infer.
 */
export function StatementPdfImportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currency = useSettingsStore((s) => s.settings.currency);
  const [stage, setStage] = useState<Stage>("idle");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [filename, setFilename] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Prefilled when arriving from an account's own page (e.g. AccountDetail's
  // "import a bank statement" link), which passes ?account=<id>.
  const [selectedAccountId, setSelectedAccountId] = useState(searchParams.get("account") ?? "");
  const [newAccountName, setNewAccountName] = useState("");
  const [pan, setPan] = useState("");
  const [dob, setDob] = useState("");
  const [holderName, setHolderName] = useState("");
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [alreadyStoredPassword, setAlreadyStoredPassword] = useState<string | null>(null);
  const [done, setDone] = useState<PdfStatementCommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<ParseLogEntry[]>([]);
  const queue = useQueuedDocumentImport("bank_statement");

  useEffect(() => {
    void listAccounts({ includeArchived: true }).then(setAccounts);
    void loadTaxProfile().then((profile) => {
      setPan(profile.pan);
      setDob(profile.dob);
      setHolderName(profile.name);
    });
  }, []);

  // Bulk-folder-import hand-off: prefill the picked file only, unlike the
  // /tax/* queued pages' auto-parse — a statement's account can't be
  // inferred from the file itself, so the user still has to choose (or
  // name) the account below before "Parse & preview" runs.
  useEffect(() => {
    if (!queue.pendingFile) return;
    const file = queue.pendingFile;
    let cancelled = false;
    void (async () => {
      const b = new Uint8Array(await file.arrayBuffer());
      if (cancelled) return;
      setBytes(b);
      setFilename(file.name);
    })();
    return () => { cancelled = true; };
  }, [queue.pendingFile]);

  const selectedAccount =
    selectedAccountId && selectedAccountId !== NEW_ACCOUNT_VALUE
      ? accounts.find((a) => String(a.id) === selectedAccountId) ?? null
      : null;
  const accountName = selectedAccountId === NEW_ACCOUNT_VALUE ? newAccountName.trim() : selectedAccount?.name ?? "";

  const handleFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setErrorLog([]);
    setBytes(new Uint8Array(await f.arrayBuffer()));
    setFilename(f.name);
  };

  const parse = async () => {
    if (!bytes) { setError("Choose a statement file first."); return; }
    if (!accountName) { setError("Choose (or name) the account this statement belongs to."); return; }
    setBusy(true);
    setError(null);
    setErrorLog([]);
    try {
      const candidates = await candidatesWithStoredPassword("bank_statement", accountName, {
        pan,
        dob,
        name: holderName,
        customerId: selectedAccount?.customer_id ?? undefined,
        password: password || undefined,
      });
      setAlreadyStoredPassword(candidates[0] ?? null);
      const result = await previewPdfStatement(bytes, filename, {
        accountName,
        passwordCandidates: candidates,
        institution: selectedAccount?.institution,
      });
      setPreview(result);
      setStage("review");
      if (result.passwordUsed) {
        void learnPatternIfNew(result.passwordUsed, {
          pan,
          dob,
          name: holderName,
          customerId: selectedAccount?.customer_id ?? undefined,
        });
      }
    } catch (err) {
      if (err instanceof DocumentPasswordRequiredError) {
        setError(
          `${err.message} Enter the password manually below, or save this account's customer ID on the ` +
            `Accounts page so it's guessed automatically next time.`,
        );
        setErrorLog(err.log);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      void writeDebugDump("bank-statement-reviewed", { filename, processed: preview.monthlyBalances });
      const result = await commitPdfStatement(preview, { defaultCurrency: currency });
      setDone(result);
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
        <PageHeader backTo="/import" backLabel="Back to import" title="Import statement" />
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
        backTo="/import"
        backLabel="Back to import"
        title="Import statement"
        description="Extract month-end balances from a bank/credit-card statement — PDF, password-protected ZIP, or Excel. Parsing happens entirely on this device — nothing is uploaded."
      />

      <Card className="mb-4 border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
        <CardContent className="flex items-start gap-2 py-3 text-xs text-blue-900 dark:text-blue-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This reads the statement's own table layout heuristically — always review the parsed monthly
            balances below before saving, especially for unusually formatted statements.
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
            {queue.queueTotal !== null && (
              <p className="text-xs text-muted-foreground">
                File {queue.queuePosition} of {queue.queueTotal} from your folder import — choose the account
                below to continue.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="statementpdf">Statement file</Label>
              <Label
                htmlFor="statementpdf"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground hover:border-primary/50"
              >
                <Upload className="h-4 w-4" />
                {filename ? <span className="font-medium text-foreground">{filename}</span> : "Choose a bank/credit-card statement (.pdf, .zip, .xlsx, .xls)"}
                <input
                  id="statementpdf"
                  type="file"
                  accept=".pdf,.zip,.xlsx,.xls,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={handleFile}
                />
              </Label>
            </div>

            <div className="space-y-1">
              <Label htmlFor="acctselect">Account</Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger id="acctselect">
                  <SelectValue placeholder="Choose the account this statement belongs to" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                      {a.is_archived ? " (archived)" : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_ACCOUNT_VALUE}>Other — add a new account…</SelectItem>
                </SelectContent>
              </Select>
              {selectedAccountId === NEW_ACCOUNT_VALUE && (
                <Input
                  className="mt-2"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="New account name, e.g. HDFC Savings"
                  autoFocus
                />
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              We try common password patterns built from your tax filer profile's PAN/date of
              birth/name and this account's saved customer ID (set it on the{" "}
              <Link to="/accounts" className="underline">Accounts</Link> page) before asking you to type
              the exact password.
            </p>

            {!pan && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Add your PAN and date of birth in your{" "}
                <Link to="/tax" className="underline">tax filer profile</Link> to enable automatic
                password matching.
              </p>
            )}

            {selectedAccount && !selectedAccount.customer_id && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No customer ID saved for this account —{" "}
                <Link to={`/accounts?edit=${selectedAccount.id}`} className="underline">add one</Link> if its
                statements are password-protected, so it's guessed automatically next time.
              </p>
            )}

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Password-protected and none of the above worked? Enter it manually</summary>
              <div className="mt-2 space-y-1">
                <Label htmlFor="stpw">Password</Label>
                <Input id="stpw" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Document password" />
              </div>
            </details>

            <div className="flex justify-end">
              <Button onClick={parse} disabled={busy || !bytes}>
                {busy ? "Parsing…" : "Parse & preview"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "review" && preview && (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Check className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">{preview.accountName}</span>
              <span className="text-muted-foreground">·</span>
              <span>
                {preview.matchedAccountId ? "matches an existing account" : "will create a new account"}
              </span>
              <span className="text-muted-foreground">·</span>
              <span>{preview.transactions.length} transaction row(s) read</span>
            </CardContent>
          </Card>

          {preview.passwordUsed && (
            <RememberPasswordPrompt
              kind="bank_statement"
              identifier={preview.accountName}
              password={preview.passwordUsed}
              label={preview.accountName}
              alreadyStored={preview.passwordUsed === alreadyStoredPassword}
            />
          )}

          {preview.warnings.length > 0 && (
            <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
              <CardContent className="space-y-1 py-3 text-xs text-amber-900 dark:text-amber-200">
                {preview.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="py-3 text-sm">
              Captured {preview.monthlyBalances.length} month-end balance{preview.monthlyBalances.length === 1 ? "" : "s"} — see below.
            </CardContent>
          </Card>

          <ParsedDocumentPanel model={preview.model} capturedData={preview.monthlyBalances} />

          <ParsingLogPanel entries={preview.log} />

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStage("idle")} disabled={busy}>Back</Button>
            <Button onClick={commit} disabled={busy || preview.monthlyBalances.length === 0}>
              {busy ? "Saving…" : "Save to accounts"}
            </Button>
          </div>
        </div>
      )}

      {stage === "done" && done && (
        <Card>
          <CardContent className="space-y-3 py-6">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-emerald-100 p-1 dark:bg-emerald-950">
                <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold">Statement imported</h3>
            </div>
            <ul className="text-sm text-muted-foreground">
              <li>{done.accountsCreated} account(s) created</li>
              <li>{done.snapshotsWritten} snapshot(s) written</li>
              <li>{done.transactionsWritten} transaction(s) recorded</li>
            </ul>
            {queue.hasNext ? (
              <div className="flex gap-2 pt-2">
                <Button onClick={() => queue.goToNextInQueue(queue.pendingAy ?? "")}>
                  Next file ({(queue.queuePosition ?? 0) + 1} of {queue.queueTotal})
                </Button>
              </div>
            ) : (
              <>
                {queue.queueTotal && queue.queueTotal > 1 && (
                  <p className="text-xs text-muted-foreground">Last of {queue.queueTotal} documents from your folder import.</p>
                )}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() =>
                      navigate(done.accountId != null ? `/transactions?account=${done.accountId}` : "/transactions")
                    }
                  >
                    View {preview?.accountName ?? "account"} transactions
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setStage("idle");
                      setBytes(null);
                      setFilename("");
                      setPreview(null);
                      setDone(null);
                      setSelectedAccountId("");
                      setNewAccountName("");
                      void listAccounts({ includeArchived: true }).then(setAccounts);
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
