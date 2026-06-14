import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTauri } from "@/lib/environment";
import { useSettingsStore } from "@/stores/settings.store";
import { formatMoney } from "@/lib/format";
import {
  DEFAULT_WIZARD_INPUTS, recommendItr, type WizardInputs,
} from "@/tax/recommendItr";
import {
  getWizardAnswers, upsertTaxYear, upsertWizardAnswers,
} from "@/db/tax";

interface QuestionDef {
  key: keyof WizardInputs;
  label: string;
  helper?: string;
  /** If "number" the user enters a numeric value, otherwise yes/no. */
  type: "yesno" | "number";
}

const QUESTIONS: QuestionDef[] = [
  { key: "isIndividual", type: "yesno",
    label: "Are you filing as an individual (not HUF, firm, LLP, company)?" },
  { key: "isResident", type: "yesno",
    label: "Are you a resident in India for tax purposes?",
    helper: "183+ days in India during the financial year (with other tests)." },
  { key: "totalIncome", type: "number",
    label: "Estimated total annual income (after exemptions)?",
    helper: "Salary + house property + capital gains + other sources." },
  { key: "hasBusinessIncome", type: "yesno",
    label: "Did you have business or professional income?",
    helper: "Includes freelancing, consulting, proprietorship, professional fees." },
  { key: "hasPresumptiveOnly", type: "yesno",
    label: "If yes — is ALL of that business income under the presumptive scheme (44AD / 44ADA / 44AE)?",
    helper: "Skip if you said No above." },
  { key: "hasCapitalGains", type: "yesno",
    label: "Any capital gains? (sold shares, mutual funds, property, gold, crypto)" },
  { key: "hasMultipleHouses", type: "yesno",
    label: "Do you have income from more than one house property?" },
  { key: "hasForeignAssetsOrIncome", type: "yesno",
    label: "Any foreign assets or foreign income during the year?" },
  { key: "isDirector", type: "yesno",
    label: "Were you a director in any company during the year?" },
  { key: "hasUnlistedShares", type: "yesno",
    label: "Did you hold unlisted equity shares (private companies, ESOPs of unlisted)?" },
  { key: "agriIncomeAbove5000", type: "yesno",
    label: "Agricultural income above ₹5,000?" },
  { key: "hasWinnings", type: "yesno",
    label: "Winnings from lotteries, races, gambling or game shows?" },
  { key: "hasBroughtForwardLosses", type: "yesno",
    label: "Brought-forward losses from earlier years to set off?" },
];

export function TaxWizardPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ay = params.get("ay") ?? "2026-27";
  const nri = params.get("nri") === "1";
  const currency = useSettingsStore((s) => s.settings.currency);

  const [inputs, setInputs] = useState<WizardInputs>(
    nri ? { ...DEFAULT_WIZARD_INPUTS, isResident: false } : DEFAULT_WIZARD_INPUTS,
  );
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load any saved answers for this AY.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isTauri()) { setLoaded(true); return; }
      try {
        const prev = await getWizardAnswers(ay);
        if (!cancelled && prev) {
          setInputs({ ...DEFAULT_WIZARD_INPUTS, ...(prev.answers as Partial<WizardInputs>) });
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [ay]);

  if (!loaded) return <div className="container py-6 text-sm text-muted-foreground">Loading…</div>;

  const total = QUESTIONS.length;
  const isReviewStep = step >= total;

  const q = QUESTIONS[step];

  const setVal = (key: keyof WizardInputs, value: WizardInputs[keyof WizardInputs]) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));

  const recommendation = recommendItr(inputs);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await upsertTaxYear(ay, { itr_form: recommendation.form, itr_form_source: "wizard" });
      await upsertWizardAnswers({
        ay,
        answers: inputs as unknown as Record<string, unknown>,
        recommended: recommendation.form,
        rationale: recommendation.reasons.join(" "),
      });
      navigate(`/tax/${encodeURIComponent(ay)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container max-w-2xl py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Link to="/tax" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to tax
        </Link>
        <span className="text-xs text-muted-foreground tabular-nums">
          AY {ay} · {isReviewStep ? "Recommendation" : `Question ${step + 1} of ${total}`}
        </span>
      </header>

      <div className="mb-4 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${(Math.min(step, total) / total) * 100}%` }} />
      </div>

      {nri && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Started in NRI mode — tax residency is pre-set to non-resident. The full ITR module is for
            India residents; this wizard only helps identify the form an NRI with India-source income files.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {!isReviewStep && q && (
        <Card>
          <CardContent className="space-y-4 py-6">
            <h3 className="text-base font-semibold">{q.label}</h3>
            {q.helper && <p className="-mt-2 text-xs text-muted-foreground">{q.helper}</p>}

            {q.type === "yesno" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={inputs[q.key] === true ? "default" : "outline"}
                  onClick={() => { setVal(q.key, true as never); next(); }}
                >
                  Yes
                </Button>
                <Button
                  variant={inputs[q.key] === false ? "default" : "outline"}
                  onClick={() => { setVal(q.key, false as never); next(); }}
                >
                  No
                </Button>
                {q.key === "hasPresumptiveOnly" && !inputs.hasBusinessIncome && (
                  <Button variant="ghost" onClick={() => { setVal(q.key, false as never); next(); }}>
                    Skip (no business income)
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2 max-w-sm">
                <Label htmlFor="num">Amount in {currency}</Label>
                <Input
                  id="num"
                  type="number"
                  inputMode="decimal"
                  value={inputs.totalIncome ?? ""}
                  onChange={(e) => setVal("totalIncome", e.target.value === "" ? null : Number(e.target.value))}
                  className="h-12 text-xl tabular-nums"
                  autoFocus
                />
                {inputs.totalIncome != null && (
                  <p className="text-xs text-muted-foreground">{formatMoney(inputs.totalIncome, currency)}</p>
                )}
                <div className="flex gap-2 pt-2">
                  <Button onClick={next} disabled={inputs.totalIncome == null}>
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="ghost" size="sm" onClick={back} disabled={step === 0}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStep(total)}>
                Skip to recommendation
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isReviewStep && (
        <div className="space-y-4">
          <Card className="border-primary/60 bg-primary/5">
            <CardContent className="space-y-3 py-6">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold">
                  Likely form: ITR-{recommendation.form ?? "—"}
                </h3>
              </div>
              <ul className="space-y-1 pl-4 text-sm">
                {recommendation.reasons.map((r, i) => (
                  <li key={i} className="list-disc">{r}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                This is informational only — verify with a Chartered Accountant before filing.
              </p>
            </CardContent>
          </Card>

          {recommendation.blockedFromItr1.length > 0 && (
            <Card>
              <CardContent className="space-y-1 py-4 text-sm">
                <p className="font-medium">Why not ITR-1:</p>
                <ul className="space-y-1 pl-4 text-xs text-muted-foreground">
                  {recommendation.blockedFromItr1.map((r, i) => <li key={i} className="list-disc">{r}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={saving || !recommendation.form}>
              {saving ? "Saving…" : <><Save className="h-4 w-4" /> Save for AY {ay}</>}
            </Button>
            <Button variant="ghost" onClick={() => setStep(0)}>
              <CheckCircle2 className="h-4 w-4" /> Edit answers
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
