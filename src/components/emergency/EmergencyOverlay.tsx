import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LifeBuoy, X, AlertTriangle, Phone, Mail, Wallet, HeartPulse, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTauri } from "@/lib/environment";
import { formatMoney } from "@/lib/format";
import { accountTypeKind, accountTypeLabel } from "@/lib/accountTypes";
import { EMERGENCY_DISCLAIMER, mailtoHref, telHref } from "@/lib/emergency";
import { openExternal } from "@/lib/openExternal";
import { useSettingsStore } from "@/stores/settings.store";
import { listAccounts, type Account } from "@/db/accounts";
import { latestSnapshotPerAccount } from "@/db/aggregates";
import { iceStore } from "@/db/sharedDb";
import type { IceCard } from "sharedcorelib/ice";

interface PortfolioRow {
  account: Account;
  value: number | null;
}

/**
 * The global "Press during Emergency" screen. Reachable from anywhere via the
 * AppShell button. Reads from plain SQLite (NOT the vault) on purpose — a family
 * member acting in an emergency won't have the master password, so emergency
 * instructions and the asset/liability portfolio must be visible while locked.
 *
 * Always shows the portfolio of assets & liabilities when accounts exist; if no
 * emergency instructions are recorded it says so but still shows the portfolio.
 */
export function EmergencyOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const currency = useSettingsStore((s) => s.settings.currency);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [valueById, setValueById] = useState<Map<number, number>>(new Map());

  const load = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [accts, latest] = await Promise.all([listAccounts(), latestSnapshotPerAccount()]);
      setAccounts(accts);
      setValueById(new Map(latest.map((l) => [l.account_id, l.value])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const withEmergency = accounts.filter((a) => a.emergency_action?.trim() || a.contact?.trim());
  const assets: PortfolioRow[] = accounts
    .filter((a) => accountTypeKind(a.type) === "asset")
    .map((a) => ({ account: a, value: valueById.get(a.id) ?? null }));
  const liabilities: PortfolioRow[] = accounts
    .filter((a) => accountTypeKind(a.type) === "liability")
    .map((a) => ({ account: a, value: valueById.get(a.id) ?? null }));

  const assetTotal = assets.reduce((s, r) => s + (r.value ?? 0), 0);
  const liabilityTotal = liabilities.reduce((s, r) => s + (r.value ?? 0), 0);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border-2 border-destructive/60 bg-background shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0">
          {/* Header */}
          <div className="flex items-start gap-3 border-b bg-destructive/5 p-4">
            <div className="rounded-md bg-destructive/15 p-2 text-destructive">
              <LifeBuoy className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-lg font-semibold tracking-tight text-destructive">
                Emergency information
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                What to do, who to call, and the current portfolio.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {/* Required disclaimer, always shown. */}
            <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/50 p-3 text-[11px] leading-snug text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{EMERGENCY_DISCLAIMER}</span>
            </div>

            {/* The suite's shared personal emergency card (common table, edited here or
                in myHealth). Independent of accounts — shown whenever the app DB is open. */}
            {isTauri() && <SharedIceCardPanel open={open} />}

            {!isTauri() ? (
              <EmptyNote text="Emergency data lives in the desktop/mobile app's database. Open the app to view it." />
            ) : loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : accounts.length === 0 ? (
              <EmptyNote text="No data available yet. Add accounts (and their emergency actions and contacts) to populate this screen." />
            ) : (
              <>
                {/* Emergency instructions */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Emergency instructions
                  </h3>
                  {withEmergency.length === 0 ? (
                    <EmptyNote text="No emergency instructions recorded yet. The portfolio below is still shown so a family member can see what exists." />
                  ) : (
                    <ul className="space-y-2">
                      {withEmergency.map((a) => (
                        <EmergencyRow key={a.id} account={a} />
                      ))}
                    </ul>
                  )}
                </section>

                {/* Portfolio */}
                <section className="space-y-3">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    <Wallet className="h-4 w-4" /> Portfolio
                  </h3>
                  <PortfolioGroup title="Assets" rows={assets} total={assetTotal} currency={currency} tone="asset" />
                  <PortfolioGroup title="Liabilities" rows={liabilities} total={liabilityTotal} currency={currency} tone="liability" />
                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm font-semibold">
                    <span>Net worth</span>
                    <span className="tabular-nums">{formatMoney(assetTotal - liabilityTotal, currency)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Values are each account's most recent recorded month; accounts with no recorded value show “—”.
                    Totals are unconverted (single-currency).
                  </p>
                </section>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The single shared personal emergency card (`common#IceCard`, person_key "self"),
 * read and editable here. myHealth populates the medical fields (allergies, conditions,
 * medications, blood group); myFinance lets a user fill in the emergency contact so it's
 * available everywhere. Edits write back to the same common table.
 */
function SharedIceCardPanel({ open }: { open: boolean }) {
  const [card, setCard] = useState<IceCard | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IceCard>({ person_key: "self" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const store = await iceStore();
      if (!store) return;
      const c = (await store.get("self")) ?? { person_key: "self" };
      setCard(c.contact_name || c.contact_phone || c.contact_email || c.blood_group || c.allergies ? c : null);
      setDraft(c);
    } catch {
      /* shared DB unavailable — hide the panel */
    }
  }, []);

  useEffect(() => { if (open) { setEditing(false); void load(); } }, [open, load]);

  const save = async () => {
    setBusy(true);
    try {
      const store = await iceStore();
      if (store) {
        await store.upsert({
          ...draft,
          person_key: "self",
          source_app: "myFinance",
          updated_at: new Date().toISOString(),
        });
      }
      setEditing(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof IceCard>(k: K, v: IceCard[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const tel = telHref(card?.contact_phone ?? null);
  const mailto = mailtoHref(card?.contact_email ?? null);

  if (!card && !editing) {
    return (
      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <HeartPulse className="h-4 w-4" /> Personal emergency card
        </h3>
        <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          <span>No shared emergency contact yet.</span>
          <Button size="sm" variant="outline" onClick={() => { setDraft({ person_key: "self" }); setEditing(true); }}>
            Add
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <HeartPulse className="h-4 w-4" /> Personal emergency card
        </h3>
        {!editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name"><Input value={draft.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} /></Field>
            <Field label="Blood group"><Input value={draft.blood_group ?? ""} onChange={(e) => set("blood_group", e.target.value)} /></Field>
            <Field label="Phone"><Input value={draft.contact_phone ?? ""} onChange={(e) => set("contact_phone", e.target.value)} /></Field>
            <Field label="Email"><Input value={draft.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); void load(); }}>Cancel</Button>
            <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 rounded-md border p-3 text-sm">
          {(card?.contact_name || card?.blood_group) && (
            <div className="flex items-center justify-between">
              <span className="font-medium">{card?.contact_name}</span>
              {card?.blood_group && (
                <span className="rounded bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">{card.blood_group}</span>
              )}
            </div>
          )}
          {card?.allergies && <Line label="Allergies" value={card.allergies} />}
          {card?.conditions && <Line label="Conditions" value={card.conditions} />}
          {card?.medications && <Line label="Medications" value={card.medications} />}
          {(tel || mailto) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {tel && (
                <Button size="sm" variant="destructive" onClick={() => void openExternal(tel)}>
                  <Phone className="h-4 w-4" /> Call now
                </Button>
              )}
              {mailto && (
                <Button size="sm" variant="outline" onClick={() => void openExternal(mailto)}>
                  <Mail className="h-4 w-4" /> Email
                </Button>
              )}
            </div>
          )}
          <p className="pt-1 text-[11px] text-muted-foreground">
            Shared across your Tokans suite apps{card?.source_app ? ` · last edited in ${card.source_app}` : ""}.
          </p>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

function EmergencyRow({ account }: { account: Account }) {
  const tel = telHref(account.contact);
  const mailto = mailtoHref(account.contact);
  return (
    <li className="rounded-md border p-3">
      <p className="font-medium">{account.name}</p>
      {account.emergency_action?.trim() && (
        <p className="mt-0.5 whitespace-pre-wrap text-sm">{account.emergency_action}</p>
      )}
      {account.contact?.trim() && (
        <p className="mt-0.5 text-xs text-muted-foreground">Contact: {account.contact}</p>
      )}
      {(tel || mailto) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tel && (
            <Button size="sm" variant="destructive" onClick={() => void openExternal(tel)}>
              <Phone className="h-4 w-4" /> Call now
            </Button>
          )}
          {mailto && (
            <Button size="sm" variant="outline" onClick={() => void openExternal(mailto)}>
              <Mail className="h-4 w-4" /> Email
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function PortfolioGroup({
  title, rows, total, currency, tone,
}: {
  title: string;
  rows: PortfolioRow[];
  total: number;
  currency: string;
  tone: "asset" | "liability";
}) {
  if (rows.length === 0) return null;
  const sign = tone === "liability" ? "-" : "";
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        <span className="tabular-nums">{sign}{formatMoney(total, currency)}</span>
      </div>
      <ul className="divide-y text-sm">
        {rows.map(({ account, value }) => (
          <li key={account.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">
              {account.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {account.type === "other" && account.type_note ? account.type_note : accountTypeLabel(account.type)}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              {value == null ? "—" : `${sign}${formatMoney(value, account.currency)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
