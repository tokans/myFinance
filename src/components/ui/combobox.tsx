import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  icon?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  /** When set, an "Add ‘<query>’" row appears for unmatched input and calls this. */
  onCreate?: (query: string) => void | Promise<void>;
  className?: string;
}

/**
 * Type-ahead autocomplete used by `FiniteSetInput` when a master has ≥10 options.
 * Built on Radix Popover (same family as `select.tsx`); filters by label and can
 * offer an inline "Add ‘…’" affordance for user-defined values.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  disabled,
  id,
  onCreate,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options;
  const exactMatch = options.some((o) => o.label.toLowerCase() === q);
  const showCreate = !!onCreate && q.length > 0 && !exactMatch;

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  const create = async () => {
    if (!onCreate) return;
    await onCreate(query.trim());
    setOpen(false);
    setQuery("");
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            {selected?.icon && <span aria-hidden>{selected.icon}</span>}
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border bg-card text-card-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <div className="border-b p-1">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-sm bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length === 1) choose(filtered[0].value);
                  else if (showCreate) void create();
                }
              }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => choose(o.value)}
                className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              >
                {o.value === value && (
                  <Check className="absolute left-2 h-4 w-4" aria-hidden />
                )}
                {o.icon && <span aria-hidden>{o.icon}</span>}
                <span className="truncate">{o.label}</span>
              </button>
            ))}

            {showCreate && (
              <button
                type="button"
                onClick={() => void create()}
                className="flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-primary outline-none hover:bg-accent"
              >
                <Plus className="h-4 w-4" aria-hidden />
                <span className="truncate">Add “{query.trim()}”</span>
              </button>
            )}

            {filtered.length === 0 && !showCreate && (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyText}</p>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
