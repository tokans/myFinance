import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isTauri } from "@/lib/environment";
import { useSettingsStore } from "@/stores/settings.store";
import { formatMoney } from "@/lib/format";
import {
  getAssessment, getTaxYear, listDeductions, listIncome, listPayments,
  type TaxAssessment, type TaxDeductionRow, type TaxIncomeRow,
  type TaxPaymentRow, type TaxYear,
} from "@/db/tax";

const HEAD_LABELS: Record<TaxIncomeRow["head"], string> = {
  salary: "Salary",
  house_property: "House property",
  other_sources: "Other sources",
  cg_short: "Short-term capital gains",
  cg_long: "Long-term capital gains",
  business: "Business / profession",
  exempt: "Exempt income",
};

const PAYMENT_LABELS: Record<TaxPaymentRow["type"], string> = {
  tds_salary: "TDS — salary",
  tds_other: "TDS — other",
  advance: "Advance tax",
  self_assessment: "Self-assessment tax",
  tcs: "TCS",
};

export function TaxDetailPage() {
  const { ay = "" } = useParams();
  const currency = useSettingsStore((s) => s.settings.currency);
  const [year, setYear] = useState<TaxYear | null>(null);
  const [income, setIncome] = useState<TaxIncomeRow[]>([]);
  const [deductions, setDeductions] = useState<TaxDeductionRow[]>([]);
  const [payments, setPayments] = useState<TaxPaymentRow[]>([]);
  const [assessment, setAssessment] = useState<TaxAssessment | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    try {
      const [y, i, d, p, a] = await Promise.all([
        getTaxYear(ay),
        listIncome(ay),
        listDeductions(ay),
        listPayments(ay),
        getAssessment(ay),
      ]);
      setYear(y); setIncome(i); setDeductions(d); setPayments(p); setAssessment(a);
    } finally {
      setLoading(false);
    }
  }, [ay]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!isTauri()) {
    return (
      <div className="container max-w-3xl py-6">
        <h2 className="text-2xl font-semibold tracking-tight">AY {ay}</h2>
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Run in the desktop app.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) return <div className="container py-6 text-sm text-muted-foreground">Loading…</div>;

  if (!year) {
    return (
      <div className="container max-w-3xl py-6">
        <Link to="/tax" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to tax
        </Link>
        <Card className="mt-4">
          <CardContent className="space-y-3 py-6 text-center">
            <p>No data for AY {ay} yet.</p>
            <div className="flex justify-center gap-2">
              <Button asChild size="sm"><Link to="/tax/import"><Upload className="h-4 w-4" /> Import ITR</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to={`/tax/wizard?ay=${ay}`}><Sparkles className="h-4 w-4" /> Run wizard</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalIncome = income.reduce((a, r) => a + r.amount, 0);
  const totalDeductions = deductions.reduce((a, r) => a + r.amount, 0);
  const totalPayments = payments.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="container max-w-3xl py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/tax" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Tax
          </Link>
          <h2 className="text-2xl font-semibold tracking-tight">AY {year.ay}</h2>
          {year.itr_form && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
              ITR-{year.itr_form}
            </span>
          )}
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={`/tax/wizard?ay=${encodeURIComponent(year.ay)}`}>
            <Sparkles className="h-4 w-4" /> Recheck form
          </Link>
        </Button>
      </header>

      {assessment && (
        <Card className="mb-4">
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-4">
            <Stat label="Gross total" v={assessment.gross_total_income} currency={currency} />
            <Stat label="Total income" v={assessment.total_income} currency={currency} />
            <Stat label="Net tax" v={assessment.net_tax_liability} currency={currency} />
            <Stat label="Refund / due" v={assessment.refund_or_balance} currency={currency} />
          </CardContent>
        </Card>
      )}

      <Section title={`Income (${income.length})`} total={totalIncome} currency={currency}>
        {income.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No income rows.</p>
        ) : (
          <RowTable rows={income.map((r) => [r.label, HEAD_LABELS[r.head], r.amount])} currency={currency} />
        )}
      </Section>

      <Section title={`Deductions (${deductions.length})`} total={totalDeductions} currency={currency}>
        {deductions.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No deductions.</p>
        ) : (
          <RowTable rows={deductions.map((r) => [r.label, r.section, r.amount])} currency={currency} />
        )}
      </Section>

      <Section title={`Tax payments (${payments.length})`} total={totalPayments} currency={currency}>
        {payments.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No payments.</p>
        ) : (
          <RowTable rows={payments.map((r) => [r.payer_name ?? "(unnamed)", PAYMENT_LABELS[r.type], r.amount])} currency={currency} />
        )}
      </Section>
    </div>
  );
}

function Section({
  title, total, currency, children,
}: {
  title: string; total: number; currency: string; children: React.ReactNode;
}) {
  return (
    <Card className="mb-3">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
          <span className="font-medium">{title}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{formatMoney(total, currency)}</span>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function RowTable({ rows, currency }: { rows: [string, string, number][]; currency: string }) {
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

function Stat({ label, v, currency }: { label: string; v: number | null; currency: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{v != null ? formatMoney(v, currency) : "—"}</p>
    </div>
  );
}
