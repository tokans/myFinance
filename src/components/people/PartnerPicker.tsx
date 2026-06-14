import { useEffect, useState } from "react";
import { BadgeCheck, Phone, Mail } from "lucide-react";
import { isTauri } from "@/lib/environment";
import { listPartners, type Partner } from "@/db/partners";

/**
 * Side panel of curated "partners" for a chosen professional type (e.g. a panel of
 * partner doctors). The partners directory ships empty, so this renders NOTHING
 * until reference data exists for the selected type — keeping the Add-People UX
 * unchanged. When partners are present, clicking one auto-fills the person form via
 * `onPick`. See src/db/partners.ts.
 */
export function PartnerPicker({
  professionalType,
  onPick,
}: {
  professionalType: string;
  onPick: (partner: Partner) => void;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const type = professionalType.trim();

  useEffect(() => {
    let cancelled = false;
    if (!isTauri() || !type) {
      setPartners([]);
      return;
    }
    listPartners(type)
      .then((rows) => { if (!cancelled) setPartners(rows); })
      .catch(() => { if (!cancelled) setPartners([]); });
    return () => { cancelled = true; };
  }, [type]);

  // No master available for this type → keep UX as-is (render nothing).
  if (partners.length === 0) return null;

  return (
    <aside className="space-y-2 rounded-lg border bg-muted/30 p-3 lg:w-64 lg:shrink-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <BadgeCheck className="h-3.5 w-3.5" />
        Available {type.toLowerCase()}s
      </div>
      <p className="text-[11px] text-muted-foreground">Pick one to fill the form, then edit if needed.</p>
      <ul className="space-y-1.5">
        {partners.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="w-full rounded-md border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/50"
            >
              <span className="flex items-center gap-1.5 font-medium">
                {p.icon && <span aria-hidden>{p.icon}</span>}
                <span className="truncate">{p.name}</span>
              </span>
              {p.notes && <span className="mt-0.5 block text-[11px] text-muted-foreground">{p.notes}</span>}
              <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                {p.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{p.phone}</span>}
                {p.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{p.email}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
