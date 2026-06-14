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
import { todayISO } from "@/lib/format";
import type { Reminder, ReminderCadence, ReminderInput } from "@/db/reminders";

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  due_date: z.string().trim().min(1, "Pick a due date"),
  cadence: z.enum(["once", "annual"]),
  notes: z.string().trim().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

export function ReminderForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Reminder;
  onSubmit: (input: ReminderInput) => Promise<void>;
  onCancel: () => void;
}) {
  const {
    register, handleSubmit, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initial?.title ?? "",
      due_date: initial?.due_date ?? todayISO(),
      cadence: initial?.cadence ?? "once",
      notes: initial?.notes ?? "",
    },
  });

  const submit = handleSubmit(async (v) => {
    await onSubmit({
      type: initial?.type ?? "custom",
      title: v.title,
      due_date: v.due_date,
      cadence: v.cadence as ReminderCadence,
      notes: v.notes || null,
    });
  });

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4">
      <div className="space-y-1.5">
        <Label htmlFor="r-title">Title</Label>
        <Input id="r-title" data-testid="reminder-form-title" placeholder="e.g. Renew car insurance" {...register("title")} />
        {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="r-due">Due date</Label>
          <Input id="r-due" type="date" {...register("due_date")} />
          {errors.due_date && <p className="text-xs text-destructive">{errors.due_date.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-cadence">Repeat</Label>
          <Select value={watch("cadence")} onValueChange={(v) => setValue("cadence", v as ReminderCadence)}>
            <SelectTrigger id="r-cadence"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="once">One-off</SelectItem>
              <SelectItem value="annual">Every year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="r-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
        <Textarea id="r-notes" className="min-h-[60px]" {...register("notes")} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
        <Button type="submit" data-testid="reminder-form-submit" disabled={isSubmitting}>{initial ? "Save" : "Add reminder"}</Button>
      </div>
    </form>
  );
}
