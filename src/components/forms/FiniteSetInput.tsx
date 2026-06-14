import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { useMaster } from "@/masters/store";
import { MASTERS } from "@/masters/registry";
import type { MasterId } from "@/masters/types";

const OTHER_SENTINEL = "__other__";

interface Props {
  masterId: MasterId;
  value: string;
  onChange: (value: string) => void;
  /** Parent selection for dependent masters (e.g. country code for `city`). */
  parentValue?: string | null;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Override the master's default "Other" affordance. */
  allowOther?: boolean;
}

/**
 * One input for any finite-set field. Renders a dropdown when the master has
 * fewer than 10 options and a type-ahead autocomplete otherwise (see
 * `pickMode`). When the master allows it, an "Other" affordance lets the user
 * add a value that is persisted to `custom_options` and merged into the master.
 */
export function FiniteSetInput({
  masterId,
  value,
  onChange,
  parentValue = null,
  id,
  placeholder,
  disabled,
  allowOther,
}: Props) {
  const def = MASTERS[masterId];
  const offerOther = allowOther ?? def.allowOther ?? true;
  const { options, mode, addOption } = useMaster(masterId, parentValue);
  const [addingOther, setAddingOther] = useState(false);
  const [otherText, setOtherText] = useState("");

  const blockedByParent = !!def.dependsOnParent && !parentValue;
  const isDisabled = disabled || blockedByParent;
  const effectivePlaceholder = blockedByParent
    ? `Choose a ${MASTERS.country.label.toLowerCase()} first`
    : placeholder ?? `Select ${def.label.toLowerCase()}…`;

  const submitOther = async () => {
    const v = await addOption(otherText);
    if (v) onChange(v);
    setAddingOther(false);
    setOtherText("");
  };

  // ── Autocomplete (≥10 options) ───────────────────────────────────────────
  if (mode === "autocomplete") {
    return (
      <Combobox
        id={id}
        options={options}
        value={value}
        onChange={onChange}
        disabled={isDisabled}
        placeholder={effectivePlaceholder}
        searchPlaceholder={`Search ${def.label.toLowerCase()}…`}
        onCreate={
          offerOther
            ? async (q) => {
                const v = await addOption(q);
                if (v) onChange(v);
              }
            : undefined
        }
      />
    );
  }

  // ── Dropdown (<10 options) ────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <Select
        value={value || undefined}
        onValueChange={(v) => {
          if (v === OTHER_SENTINEL) {
            setAddingOther(true);
            return;
          }
          setAddingOther(false);
          onChange(v);
        }}
        disabled={isDisabled}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={effectivePlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.icon ? `${o.icon}  ${o.label}` : o.label}
            </SelectItem>
          ))}
          {offerOther && <SelectItem value={OTHER_SENTINEL}>Other…</SelectItem>}
        </SelectContent>
      </Select>

      {addingOther && (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitOther();
              }
            }}
            placeholder={`Add a ${def.label.toLowerCase()}…`}
            maxLength={64}
          />
          <Button type="button" size="sm" onClick={() => void submitOther()} disabled={!otherText.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setAddingOther(false);
              setOtherText("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
