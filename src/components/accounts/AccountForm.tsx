import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Landmark,
  Wallet,
  Banknote,
  PiggyBank,
  CalendarClock,
  ShieldCheck,
  Briefcase,
  Umbrella,
  TrendingUp,
  PieChart,
  Layers,
  ScrollText,
  LineChart,
  Gem,
  Home,
  Bitcoin,
  HandCoins,
  CreditCard,
  Shield,
  MoreHorizontal,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FiniteSetInput } from "@/components/forms/FiniteSetInput";
import { cn } from "@/lib/utils";
import { EMERGENCY_DISCLAIMER, mentionsContact } from "@/lib/emergency";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_VALUES,
  DEFAULT_ACCOUNT_TYPE,
  SPRITE_URL,
  SPRITE_COLS,
  SPRITE_ROWS,
  SPRITE_CELL_COUNT,
  spriteCellPosition,
} from "@/lib/accountTypes";
import { inferInstitution, inferAccountTypeForName } from "@/lib/institutions";
import type { Account, AccountInput, AccountType } from "@/db/accounts";

/** Inline fallback icons, keyed to ACCOUNT_TYPES order, used until/if the
 *  generated sprite at SPRITE_URL is available. */
const FALLBACK_ICONS: Record<AccountType, LucideIcon> = {
  bank_savings: Landmark,
  checking: Wallet,
  cash: Banknote,
  fixed_deposit: PiggyBank,
  recurring_deposit: CalendarClock,
  ppf: ShieldCheck,
  epf: Briefcase,
  nps: Umbrella,
  stocks: TrendingUp,
  mutual_funds: PieChart,
  etf: Layers,
  bonds: ScrollText,
  pms_aif: LineChart,
  gold: Gem,
  real_estate: Home,
  crypto: Bitcoin,
  loan: HandCoins,
  credit_card: CreditCard,
  insurance: Shield,
  other: MoreHorizontal,
  tax_refund: Receipt,
};

/** Probe whether the sprite asset exists so we can prefer it over lucide icons. */
function useSpriteAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setOk(img.naturalWidth > 0);
    img.onerror = () => setOk(false);
    img.src = SPRITE_URL;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, []);
  return ok;
}

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64),
  type: z.enum(ACCOUNT_TYPE_VALUES),
  institution: z.string().trim().max(64).optional(),
  opening_balance: z.coerce.number().finite(),
  type_note: z.string().trim().max(64).optional(),
  maturity_date: z.string().trim().optional(),
  sip_day: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (/^\d+$/.test(v) && +v >= 1 && +v <= 31), "Day must be 1–31"),
  sip_amount: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (Number.isFinite(+v) && +v > 0), "Enter a positive amount"),
  contact: z.string().trim().max(200).optional(),
  emergency_action: z.string().trim().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  initial?: Account;
  defaultCurrency: string;
  onSubmit: (values: AccountInput) => Promise<void>;
  onCancel: () => void;
  disabled?: boolean;
}

export function AccountForm({ initial, defaultCurrency, onSubmit, onCancel, disabled }: Props) {
  const spriteOk = useSpriteAvailable();
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "",
      type: initial?.type ?? DEFAULT_ACCOUNT_TYPE,
      institution: initial?.institution ?? "",
      opening_balance: initial?.opening_balance ?? 0,
      type_note: initial?.type_note ?? "",
      maturity_date: initial?.maturity_date ?? "",
      sip_day: initial?.sip_day != null ? String(initial.sip_day) : "",
      sip_amount: initial?.sip_amount != null ? String(initial.sip_amount) : "",
      contact: initial?.contact ?? "",
      emergency_action: initial?.emergency_action ?? "",
    },
  });

  const submit = handleSubmit(async (values) => {
    await onSubmit({
      name: values.name,
      type: values.type,
      institution: values.institution ?? null,
      opening_balance: values.opening_balance,
      currency: initial?.currency ?? defaultCurrency,
      type_note: values.type === "other" ? values.type_note ?? null : null,
      maturity_date: values.type === "fixed_deposit" ? values.maturity_date || null : null,
      sip_day: values.type === "mutual_funds" && values.sip_day ? Number(values.sip_day) : null,
      sip_amount: values.type === "mutual_funds" && values.sip_amount ? Number(values.sip_amount) : null,
      contact: values.contact || null,
      emergency_action: values.emergency_action || null,
    });
  });

  const typeValue = watch("type");
  const nameValue = watch("name");
  const institutionValue = watch("institution");
  const emergencyActionValue = watch("emergency_action");
  const contactValue = watch("contact");
  // Nudge: the action says "call/contact someone" but no contact is attached yet.
  const needsContact = mentionsContact(emergencyActionValue) && !contactValue?.trim();

  // Auto-pick the type from the name (e.g. "Home Loan" → loan) for NEW accounts,
  // until the user manually chooses one. Editing an existing account never
  // auto-overrides its saved type.
  const [typeTouched, setTypeTouched] = useState(false);
  useEffect(() => {
    if (initial || typeTouched) return;
    // Explicit type word in the name wins ("HDFC FD" → fixed_deposit); otherwise
    // fall back to the type the matched institution implies ("Zerodha" → stocks,
    // "SBI" → bank savings).
    const inferred = inferAccountTypeForName(nameValue);
    if (inferred && inferred !== typeValue) {
      setValue("type", inferred, { shouldValidate: true });
    }
  }, [nameValue, initial, typeTouched, typeValue, setValue]);

  // Same for the (optional) institution: match a run of consecutive letters in
  // the name against the known institution list (e.g. "HDFC Savings" → "HDFC
  // Bank"). Only for NEW accounts, and only until the user edits the field.
  const [institutionTouched, setInstitutionTouched] = useState(false);
  useEffect(() => {
    if (initial || institutionTouched) return;
    const inferred = inferInstitution(nameValue);
    if (inferred && inferred !== institutionValue) {
      setValue("institution", inferred, { shouldValidate: true });
    }
  }, [nameValue, initial, institutionTouched, institutionValue, setValue]);

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" data-testid="account-form-name" placeholder="e.g. HDFC Savings" {...register("name")} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>Type</Label>
        <div
          role="radiogroup"
          aria-label="Account type"
          className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5"
        >
          {ACCOUNT_TYPES.map((t, index) => {
            const selected = typeValue === t.value;
            const Icon = FALLBACK_ICONS[t.value];
            const pos = spriteCellPosition(index);
            // Types appended beyond the baked sprite use the inline lucide icon.
            const useSprite = spriteOk && index < SPRITE_CELL_COUNT;
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={selected ? "true" : "false"}
                title={t.hint}
                onClick={() => { setTypeTouched(true); setValue("type", t.value, { shouldValidate: true }); }}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-2 text-center transition-colors",
                  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary bg-accent ring-1 ring-primary" : "border-border",
                )}
              >
                {useSprite ? (
                  <span
                    aria-hidden
                    className="h-10 w-10 rounded-md bg-no-repeat"
                    style={{
                      backgroundImage: `url(${SPRITE_URL})`,
                      backgroundSize: `${SPRITE_COLS * 100}% ${SPRITE_ROWS * 100}%`,
                      backgroundPosition: `${pos.x}% ${pos.y}%`,
                    }}
                  />
                ) : (
                  <Icon className="h-7 w-7 text-muted-foreground" aria-hidden />
                )}
                <span className="text-[11px] font-medium leading-tight">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {typeValue === "other" && (
        <div className="space-y-1.5">
          <Label htmlFor="type_note">Describe this account type</Label>
          <Input
            id="type_note"
            placeholder="e.g. Chit fund, employee stock options…"
            {...register("type_note")}
          />
          {errors.type_note && <p className="text-xs text-destructive">{errors.type_note.message}</p>}
        </div>
      )}

      {typeValue === "fixed_deposit" && (
        <div className="space-y-1.5">
          <Label htmlFor="maturity_date">Maturity date <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="maturity_date" type="date" {...register("maturity_date")} />
          {errors.maturity_date && <p className="text-xs text-destructive">{errors.maturity_date.message}</p>}
        </div>
      )}

      {typeValue === "mutual_funds" && (
        <div className="space-y-3 rounded-md border border-dashed p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            SIP reminder <span className="text-xs font-normal text-muted-foreground">(optional)</span>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Set the monthly SIP debit day to get a reminder a few days before, until you mark it
            Done or Ignore.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sip_day">SIP day of month</Label>
              <Input
                id="sip_day"
                type="number"
                min={1}
                max={31}
                step={1}
                placeholder="e.g. 5"
                {...register("sip_day")}
              />
              {errors.sip_day && <p className="text-xs text-destructive">{errors.sip_day.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sip_amount">
                SIP amount <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="sip_amount"
                type="number"
                step="0.01"
                placeholder="e.g. 5000"
                {...register("sip_amount")}
              />
              {errors.sip_amount && <p className="text-xs text-destructive">{errors.sip_amount.message}</p>}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="institution">Institution <span className="text-muted-foreground">(optional)</span></Label>
          <FiniteSetInput
            id="institution"
            masterId="institution"
            value={watch("institution") ?? ""}
            onChange={(v) => { setInstitutionTouched(true); setValue("institution", v, { shouldValidate: true }); }}
            placeholder="e.g. HDFC Bank"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="opening">Opening balance ({initial?.currency ?? defaultCurrency})</Label>
          <Input
            id="opening"
            type="number"
            step="0.01"
            {...register("opening_balance")}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-dashed p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <LifeBuoy className="h-4 w-4 text-muted-foreground" />
          Prepare for emergencies <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="emergency_action">
            Emergency action <span className="text-muted-foreground">— what should family do for this account?</span>
          </Label>
          <Textarea
            id="emergency_action"
            placeholder="e.g. Call the relationship manager to claim the FD; nominee is registered."
            className="min-h-[64px]"
            {...register("emergency_action")}
          />
          {errors.emergency_action && (
            <p className="text-xs text-destructive">{errors.emergency_action.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contact">
            Contact <span className="text-muted-foreground">— who to reach (name + phone/email)</span>
          </Label>
          <Input
            id="contact"
            placeholder="e.g. Priya Sharma (RM) +91 98765 43210"
            {...register("contact")}
          />
          {errors.contact && <p className="text-xs text-destructive">{errors.contact.message}</p>}
        </div>

        {needsContact && (
          <div className="rounded-md border border-amber-300/60 bg-amber-50/50 p-2.5 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
            This action mentions calling or contacting someone. Add their name and number in{" "}
            <span className="font-medium">Contact</span> above so a "Press during Emergency" button can
            reach them. Make sure you have that person's consent to be listed.
          </div>
        )}

        <p className="text-[11px] leading-snug text-muted-foreground">{EMERGENCY_DISCLAIMER}</p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
        <Button type="submit" data-testid="account-form-submit" disabled={disabled || isSubmitting}>
          {initial ? "Save" : "Add account"}
        </Button>
      </div>
    </form>
  );
}
