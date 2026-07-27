import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Check, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isTauri } from "@/lib/environment";
import { formatMoney } from "@/lib/format";
import {
  clearAyRows, getTaxYear, insertDeduction, insertIncome, insertPayment,
  listDeductions, listIncome, listPayments, upsertAssessment, upsertTaxYear,
  type IncomeHead, type ItrForm, type PaymentType,
  type TaxDeductionRow, type TaxIncomeRow, type TaxPaymentRow,
} from "@/db/tax";
import { listAccounts, type Account } from "@/db/accounts";
import { loadTaxProfile, saveTaxProfile, EMPTY_TAX_PROFILE, type TaxProfile } from "@/tax/taxProfile";
import { type Regime } from "@/tax/taxCompute";
import { buildItrJson } from "@/tax/itrBuilder";
import { splitClubbedIncome, clubbedIncomeRow, clubbedAccountId, clubbedFullAmount } from "@/tax/clubbedIncome";

const INCOME_HEADS: { head: IncomeHead; label: string }[] = [
  { head: "salary", label: "Salary / pension (chargeable)" },
  { head: "house_property", label: "House property" },
  { head: "other_sources", label: "Other sources (interest, etc.)" },
  { head: "dividend", label: "Dividend income" },
  { head: "cg_short", label: "Short-term capital gains" },
  { head: "cg_long", label: "Long-term capital gains" },
  { head: "business", label: "Business / profession (presumptive)" },
  { head: "exempt", label: "Exempt income" },
];

const COMMON_SECTIONS = ["80C", "80CCD(1B)", "80CCD(2)", "80D", "80E", "80G", "80TTA", "80TTB"];

const SECTION_LABELS: Record<string, string> = {
  "80C": "80C — LIC / PPF / ELSS / EPF",
  "80CCD(1B)": "80CCD(1B) — NPS extra ₹50k",
  "80CCD(2)": "80CCD(2) — employer NPS",
  "80D": "80D — health insurance",
  "80E": "80E — education loan interest",
  "80G": "80G — donations",
  "80TTA": "80TTA — savings interest",
  "80TTB": "80TTB — senior citizen interest",
};

const PAYMENT_TYPES: { type: PaymentType; label: string }[] = [
  { type: "tds_salary", label: "TDS — salary" },
  { type: "tds_other", label: "TDS — other than salary" },
  { type: "advance", label: "Advance tax" },
  { type: "self_assessment", label: "Self-assessment tax" },
  { type: "tcs", label: "TCS" },
];

/**
 * Fill an ITR return and download it as a best-effort, advisory JSON. Prefilled
 * from whatever income/deductions/TDS are already saved for the AY (ITR/AIS
 * import), editable, computed against both regimes, and exported via
 * itrBuilder.buildItrJson (which round-trips through the importer).
 */
export function TaxReturnPage() {
  const { ay = "2026-27" } = useParams();

  const [form, setForm] = useState<ItrForm>("1");
  const [profile, setProfile] = useState<TaxProfile>({ ...EMPTY_TAX_PROFILE });
  const [income, setIncome] = useState<Record<string, number>>({});
  const [deductions, setDeductions] = useState<Record<string, number>>({});
  const [payments, setPayments] = useState<Record<string, number>>({});
  // Minor-flagged family accounts (AccountForm's "family" + "minor child" toggles) whose
  // income can be clubbed into this return (Sec 64(1A)), keyed by account id → the
  // pre-exemption amount the user typed. Adult family accounts never appear here.
  const [minorAccounts, setMinorAccounts] = useState<Account[]>([]);
  const [adultFamilyCount, setAdultFamilyCount] = useState(0);
  const [clubbedAmounts, setClubbedAmounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    try {
      const [year, inc, ded, pay, prof, accts] = await Promise.all([
        getTaxYear(ay), listIncome(ay), listDeductions(ay), listPayments(ay), loadTaxProfile(), listAccounts(),
      ]);
      if (year?.itr_form) setForm(year.itr_form);
      setProfile({ ...EMPTY_TAX_PROFILE, ...prof });
      // Clubbed-minor rows (source_path "CLUB:<accountId>") are saved separately from the
      // plain per-head totals below — fold them in here and they'd double as an ordinary
      // "Other sources" figure, losing which part came from a specific minor's account.
      const incMap: Record<string, number> = {};
      const clubMap: Record<number, number> = {};
      for (const r of inc) {
        const acctId = clubbedAccountId(r.source_path);
        if (acctId != null) { clubMap[acctId] = clubbedFullAmount(r); continue; }
        incMap[r.head] = (incMap[r.head] ?? 0) + r.amount;
      }
      setIncome(incMap);
      setClubbedAmounts(clubMap);
      setMinorAccounts(accts.filter((a) => a.is_family && a.family_relation === "minor"));
      setAdultFamilyCount(accts.filter((a) => a.is_family && a.family_relation !== "minor").length);
      const dedMap: Record<string, number> = {};
      for (const r of ded) dedMap[r.section] = (dedMap[r.section] ?? 0) + r.amount;
      setDeductions(dedMap);
      const payMap: Record<string, number> = {};
      for (const r of pay) payMap[r.type] = (payMap[r.type] ?? 0) + r.amount;
      setPayments(payMap);
    } finally {
      setLoading(false);
    }
  }, [ay]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Union of common sections and any already present in the data.
  const sections = useMemo(
    () => Array.from(new Set([...COMMON_SECTIONS, ...Object.keys(deductions)])),
    [deductions],
  );

  // Build synthetic DB rows from the aggregate maps to feed the builder.
  const incomeRows = useMemo<TaxIncomeRow[]>(
    () => INCOME_HEADS.filter((h) => (income[h.head] ?? 0) !== 0).map((h) => ({
      id: 0, ay, head: h.head, label: h.label, amount: income[h.head] ?? 0, source_path: null, note: null, excluded: false,
    })),
    [income, ay],
  );
  const deductionRows = useMemo<TaxDeductionRow[]>(
    () => sections.filter((s) => (deductions[s] ?? 0) !== 0).map((s) => ({
      id: 0, ay, section: s, label: SECTION_LABELS[s] ?? s, amount: deductions[s] ?? 0, source_path: null, note: null,
    })),
    [sections, deductions, ay],
  );
  const paymentRows = useMemo<TaxPaymentRow[]>(
    () => PAYMENT_TYPES.filter((p) => (payments[p.type] ?? 0) !== 0).map((p) => ({
      id: 0, ay, type: p.type, payer_name: null, amount: payments[p.type] ?? 0, source_path: null, note: null,
    })),
    [payments, ay],
  );

  // One row per minor with a non-zero income entry, already net of the Sec 10(32)
  // exemption (see clubbedIncome.ts) — added to "other sources" on top of the plain
  // manual figure above, never mixed into it.
  const clubbedRows = useMemo(
    () => minorAccounts
      .filter((a) => (clubbedAmounts[a.id] ?? 0) > 0)
      .map((a) => clubbedIncomeRow(ay, a, clubbedAmounts[a.id] ?? 0)),
    [minorAccounts, clubbedAmounts, ay],
  );
  const allIncomeRows = useMemo<TaxIncomeRow[]>(
    () => [...incomeRows, ...clubbedRows.map((r) => ({ id: 0, ...r }))],
    [incomeRows, clubbedRows],
  );

  // Deductions allowed under each regime (new regime u/s 115BAC allows only 80CCD(2)).
  // Clubbing applies identically under both regimes, so allIncomeRows is regime-agnostic.
  const buildFor = useCallback(
    (regime: Regime, prof = profile) =>
      buildItrJson({
        ay, form, profile: prof, regime,
        income: allIncomeRows,
        deductions: regime === "new" ? deductionRows.filter((d) => d.section === "80CCD(2)") : deductionRows,
        payments: paymentRows,
      }),
    [ay, form, profile, allIncomeRows, deductionRows, paymentRows],
  );

  const oldBuilt = useMemo(() => buildFor("old"), [buildFor]);
  const newBuilt = useMemo(() => buildFor("new"), [buildFor]);
  const selected = profile.regime === "old" ? oldBuilt : newBuilt;

  const setProfileField = (patch: Partial<TaxProfile>) => setProfile((p) => ({ ...p, ...patch }));

  const saveFigures = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      await saveTaxProfile(profile);
      await upsertTaxYear(ay, { itr_form: form, itr_form_source: "manual" });
      await clearAyRows(ay);
      for (const r of incomeRows) await insertIncome({ ...r, source_path: `MANUAL:${r.head}`, note: "Return builder" });
      for (const r of clubbedRows) await insertIncome(r);
      for (const r of deductionRows) await insertDeduction({ ...r, source_path: `MANUAL:${r.section}`, note: "Return builder" });
      for (const r of paymentRows) await insertPayment({ ...r, source_path: `MANUAL:${r.type}`, note: "Return builder" });
      await upsertAssessment({
        ay,
        gross_total_income: selected.summary.grossTotalIncome,
        total_deductions: selected.summary.totalDeductions,
        total_income: selected.summary.totalIncome,
        total_tax_payable: selected.summary.netTaxLiability,
        rebate_87a: null,
        education_cess: null,
        net_tax_liability: selected.summary.netTaxLiability,
        total_taxes_paid: selected.summary.totalTaxesPaid,
        refund_or_balance: selected.summary.refundOrBalance,
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true); setError(null);
    try {
      await saveTaxProfile(profile);
      const text = JSON.stringify(selected.json, null, 2);
      const bytes = new TextEncoder().encode(text);
      const filename = `${profile.pan || "return"}_${ay}_ITR${form}.json`;
      if (isTauri()) {
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({ defaultPath: filename, filters: [{ name: "ITR JSON", extensions: ["json"] }] });
        if (!path) return;
        await writeFile(path, bytes);
      } else {
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-3xl py-6">
        <BackLink ay={ay} />
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Run in the desktop app to prepare a return.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) return <div className="container py-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo={`/tax/${encodeURIComponent(ay)}`}
        backLabel={`Back to AY ${ay}`}
        title={`Prepare return — AY ${ay}`}
        description="Fill the figures, choose your regime, and download an ITR JSON to upload."
      />

      <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-2 py-3 text-xs text-amber-900 dark:text-amber-200">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Best-effort draft.</strong> This is not validated against the official ITR schema and is not
            a substitute for a Chartered Accountant. Review every figure and upload it yourself on the
            Income-Tax portal.
          </span>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-4 border-destructive/60"><CardContent className="py-3 text-xs text-destructive">{error}</CardContent></Card>
      )}

      {/* Form + regime */}
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Return</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs">ITR form</Label>
            <Select value={form} onValueChange={(v) => setForm(v as ItrForm)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">ITR-1 (Sahaj)</SelectItem>
                <SelectItem value="2">ITR-2</SelectItem>
                <SelectItem value="4">ITR-4 (Sugam)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tax regime</Label>
            <Select value={profile.regime} onValueChange={(v) => setProfileField({ regime: v as Regime })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New regime</SelectItem>
                <SelectItem value="old">Old regime</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Filer profile */}
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Filer details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="PAN" value={profile.pan} onChange={(v) => setProfileField({ pan: v.toUpperCase() })} />
          <Field label="Full name" value={profile.name} onChange={(v) => setProfileField({ name: v })} />
          <Field label="Date of birth (YYYY-MM-DD)" value={profile.dob} onChange={(v) => setProfileField({ dob: v })} />
          <Field label="Aadhaar" value={profile.aadhaar} onChange={(v) => setProfileField({ aadhaar: v })} />
          <Field label="Email" value={profile.email} onChange={(v) => setProfileField({ email: v })} />
          <Field label="Mobile" value={profile.mobile} onChange={(v) => setProfileField({ mobile: v })} />
          <Field label="City" value={profile.city} onChange={(v) => setProfileField({ city: v })} />
          <Field label="PIN code" value={profile.pinCode} onChange={(v) => setProfileField({ pinCode: v })} />
          <Field label="Refund bank IFSC" value={profile.bankIfsc} onChange={(v) => setProfileField({ bankIfsc: v.toUpperCase() })} />
          <Field label="Refund account no." value={profile.bankAccountNumber} onChange={(v) => setProfileField({ bankAccountNumber: v })} />
        </CardContent>
      </Card>

      {/* Income */}
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Income</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {INCOME_HEADS.map((h) => (
            <NumField key={h.head} label={h.label} value={income[h.head] ?? 0} onChange={(n) => setIncome((m) => ({ ...m, [h.head]: n }))} />
          ))}
        </CardContent>
      </Card>

      {/* Clubbed minor income (Sec 64(1A)) */}
      {(minorAccounts.length > 0 || adultFamilyCount > 0) && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Family accounts &amp; this return</CardTitle>
            <CardDescription>
              A minor child&apos;s account income is added to your own total income here (Sec 64(1A)), minus the
              ₹1,500-per-child exemption (Sec 10(32)). An adult family member&apos;s accounts are tracked on the
              Dashboard only and never added to your return.
            </CardDescription>
          </CardHeader>
          {minorAccounts.length > 0 && (
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {minorAccounts.map((a) => {
                const amount = clubbedAmounts[a.id] ?? 0;
                const split = splitClubbedIncome(amount);
                return (
                  <div key={a.id} className="space-y-1">
                    <NumField
                      label={`${a.name} — this minor's income for the AY`}
                      value={amount}
                      onChange={(n) => setClubbedAmounts((m) => ({ ...m, [a.id]: n }))}
                    />
                    {amount > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {formatMoney(split.exemptPortion, "INR")} exempt (Sec 10(32)) ·{" "}
                        {formatMoney(split.taxablePortion, "INR")} added to your other-sources income
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          )}
          {adultFamilyCount > 0 && (
            <CardContent className="pt-0 text-xs text-muted-foreground">
              {adultFamilyCount} adult family account{adultFamilyCount === 1 ? "" : "s"} tracked on the Dashboard —
              excluded from this return.
            </CardContent>
          )}
        </Card>
      )}

      {/* Deductions */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Chapter VI-A deductions</CardTitle>
          {profile.regime === "new" && (
            <p className="text-xs text-muted-foreground">New regime: only 80CCD(2) reduces taxable income — others are entered for record only.</p>
          )}
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {sections.map((s) => (
            <NumField key={s} label={SECTION_LABELS[s] ?? s} value={deductions[s] ?? 0} onChange={(n) => setDeductions((m) => ({ ...m, [s]: n }))} />
          ))}
        </CardContent>
      </Card>

      {/* Payments */}
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Taxes already paid</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {PAYMENT_TYPES.map((p) => (
            <NumField key={p.type} label={p.label} value={payments[p.type] ?? 0} onChange={(n) => setPayments((m) => ({ ...m, [p.type]: n }))} />
          ))}
        </CardContent>
      </Card>

      {/* Computation + regime comparison */}
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Tax computation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <RegimeCard title="New regime" summary={newBuilt.summary} active={profile.regime === "new"} />
            <RegimeCard title="Old regime" summary={oldBuilt.summary} active={profile.regime === "old"} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <Stat label="Gross total income" v={selected.summary.grossTotalIncome} />
            <Stat label="Deductions" v={selected.summary.totalDeductions} />
            <Stat label="Total income" v={selected.summary.totalIncome} />
            <Stat label="Net tax" v={selected.summary.netTaxLiability} />
            <Stat label="Taxes paid" v={selected.summary.totalTaxesPaid} />
            <Stat
              label={selected.summary.refundOrBalance >= 0 ? "Balance payable" : "Refund due"}
              v={Math.abs(selected.summary.refundOrBalance)}
            />
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={saveFigures} disabled={busy}>
          {saved ? <Check className="h-4 w-4" /> : null} {busy ? "Saving…" : saved ? "Saved" : "Save figures to AY"}
        </Button>
        <Button onClick={download} disabled={busy}>
          <Download className="h-4 w-4" /> Download ITR JSON
        </Button>
      </div>
    </div>
  );
}

function BackLink({ ay }: { ay: string }) {
  return (
    <Link to={`/tax/${encodeURIComponent(ay)}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> Back to AY {ay}
    </Link>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        inputMode="numeric"
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        onChange={(e) => {
          const n = Number(e.target.value.replace(/,/g, ""));
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    </div>
  );
}

function RegimeCard({ title, summary, active }: { title: string; summary: { netTaxLiability: number }; active: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${active ? "border-primary bg-primary/5" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-lg font-semibold tabular-nums">{formatMoney(summary.netTaxLiability, "INR")}</p>
      <p className="text-[11px] text-muted-foreground">net tax</p>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{formatMoney(v, "INR")}</dd>
    </div>
  );
}
