import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentMonth } from "@/lib/format";

const schema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM"),
  value: z.coerce.number().finite(),
  note: z.string().trim().max(200).optional(),
});

export type SnapshotFormValues = z.infer<typeof schema>;

interface Props {
  defaultMonth?: string;
  defaultValue?: number;
  defaultNote?: string | null;
  currency: string;
  submitLabel?: string;
  onSubmit: (values: SnapshotFormValues) => Promise<void>;
  onCancel?: () => void;
  disabled?: boolean;
}

export function SnapshotForm({
  defaultMonth,
  defaultValue,
  defaultNote,
  currency,
  submitLabel = "Save snapshot",
  onSubmit,
  onCancel,
  disabled,
}: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SnapshotFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      month: defaultMonth ?? currentMonth(),
      value: defaultValue ?? 0,
      note: defaultNote ?? "",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="month">Month</Label>
          <Input id="month" type="month" {...register("month")} />
          {errors.month && <p className="text-xs text-destructive">{errors.month.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="value">Value ({currency})</Label>
          <Input id="value" type="number" step="0.01" {...register("value")} />
          {errors.value && <p className="text-xs text-destructive">{errors.value.message}</p>}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="note">Note <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="note" maxLength={200} {...register("note")} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={disabled || isSubmitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}
