import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FiniteSetInput } from "@/components/forms/FiniteSetInput";
import { PartnerPicker } from "@/components/people/PartnerPicker";
import { ACCESS_TIERS } from "@/lib/accessTiers";
import type { AccessTier, Person, PersonInput } from "@/db/people";
import type { Partner } from "@/db/partners";

/** Which directory the person is being added to. Drives the relationship field and
 *  (for professionals) the curated-partner side panel. */
export type PersonKind = "personal" | "professional";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  relationship: z.string().trim().max(64).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(120).optional(),
  id_proof_ref: z.string().trim().max(80).optional(),
  access_tier: z.coerce.number().int().min(0).max(2),
  notes: z.string().trim().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

export function PersonForm({
  initial,
  kind = "personal",
  onSubmit,
  onCancel,
}: {
  initial?: Person;
  kind?: PersonKind;
  onSubmit: (input: PersonInput) => Promise<void>;
  onCancel: () => void;
}) {
  const isPro = kind === "professional";
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
      relationship: initial?.relationship ?? "",
      phone: initial?.phone ?? "",
      email: initial?.email ?? "",
      id_proof_ref: initial?.id_proof_ref ?? "",
      access_tier: initial?.access_tier ?? 0,
      notes: initial?.notes ?? "",
    },
  });

  const submit = handleSubmit(async (v) => {
    await onSubmit({
      name: v.name,
      relationship: v.relationship || null,
      phone: v.phone || null,
      email: v.email || null,
      id_proof_ref: v.id_proof_ref || null,
      access_tier: v.access_tier as AccessTier,
      notes: v.notes || null,
    });
  });

  const tier = String(watch("access_tier"));
  const professionalType = watch("relationship") ?? "";

  // Auto-fill from a curated partner; existing values are overwritten so a click
  // gives a clean starting point the user can still edit.
  const fillFromPartner = (p: Partner) => {
    setValue("name", p.name, { shouldValidate: true });
    setValue("relationship", p.professional_type, { shouldValidate: true });
    setValue("phone", p.phone ?? "");
    setValue("email", p.email ?? "");
    if (p.notes) setValue("notes", p.notes);
  };

  const form = (
    <form onSubmit={submit} className="flex-1 space-y-4 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-name">Name</Label>
          <Input id="p-name" data-testid="person-form-name" placeholder="e.g. Priya Sharma" {...register("name")} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-rel">
            {isPro ? "Professional type" : "Relationship"}{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <FiniteSetInput
            id="p-rel"
            masterId={isPro ? "professional_type" : "relationship"}
            value={watch("relationship") ?? ""}
            onChange={(val) => setValue("relationship", val, { shouldValidate: true })}
            placeholder={isPro ? "e.g. Doctor" : "e.g. Spouse"}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-phone">Phone <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="p-phone" data-testid="person-form-phone" placeholder="+91 98765 43210" {...register("phone")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-email">Email <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="p-email" type="email" placeholder="name@example.com" {...register("email")} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-tier">Access tier</Label>
          <Select value={tier} onValueChange={(v) => setValue("access_tier", Number(v) as AccessTier)}>
            <SelectTrigger id="p-tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCESS_TIERS.map((t) => (
                <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {ACCESS_TIERS.find((t) => t.value === Number(tier))?.hint}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-id">ID proof reference <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="p-id" placeholder="e.g. Aadhaar ••••1234" {...register("id_proof_ref")} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="p-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
        <Textarea id="p-notes" className="min-h-[60px]" {...register("notes")} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
        <Button type="submit" data-testid="person-form-submit" disabled={isSubmitting}>
          {initial ? "Save" : isPro ? "Add professional" : "Add person"}
        </Button>
      </div>
    </form>
  );

  if (!isPro) return form;

  // Professionals get a curated-partner side panel beside the form. It renders
  // nothing when no partners exist for the chosen type, leaving the form full-width.
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {form}
      <PartnerPicker professionalType={professionalType} onPick={fillFromPartner} />
    </div>
  );
}
