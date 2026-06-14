import { useCallback, useEffect, useState } from "react";
import { LayoutGrid, Download, ExternalLink, Check, ArrowUpCircle, Trash2, Sparkles } from "lucide-react";
import type { AppCatalogEntry } from "sharedcorelib/suite";
import { suiteCatalog } from "@/suite/catalog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The app marketplace ("More from this publisher"). Lists every app the publisher
 * ships — installed and not — sourced from the shared registry and joined with this
 * device's local install/sync state by `sharedcorelib/suite`'s `createAppCatalog`.
 * The page is pure presentation over that catalog; all actions are OS-mediated.
 */
export function SuitePage() {
  const [entries, setEntries] = useState<AppCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setEntries(await suiteCatalog.list());
    } catch (e) {
      console.error("suite: failed to load catalog", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onRegistry = () => void load();
    window.addEventListener("suite:registry-updated", onRegistry);
    return () => window.removeEventListener("suite:registry-updated", onRegistry);
  }, [load]);

  const act = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        console.error("suite: action failed", e);
      } finally {
        await load();
      }
    },
    [load],
  );

  const installed = entries.filter((e) => e.local.installed);
  const available = entries.filter((e) => !e.local.installed && !e.isCurrentApp);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">More from Tokans</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Other apps from the same publisher. Everything is local-first and receive-only —
          installing is handled by your operating system.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {installed.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Installed</h2>
              <div className="space-y-2">
                {installed.map((e) => (
                  <AppRow key={e.appId} entry={e} onAct={act} />
                ))}
              </div>
            </section>
          )}

          {available.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Discover</h2>
              <div className="space-y-2">
                {available.map((e) => (
                  <AppRow key={e.appId} entry={e} onAct={act} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AppRow({
  entry,
  onAct,
}: {
  entry: AppCatalogEntry;
  onAct: (fn: () => Promise<void>) => Promise<void>;
}) {
  const { appId, name, tagline, isCurrentApp, updateAvailable, primaryAction } = entry;

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {entry.icon ? (
            <img src={entry.icon} alt="" className="h-7 w-7 rounded" />
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{name}</span>
            {isCurrentApp && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">This app</span>
            )}
            {entry.access === "partner" && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                Partner
              </span>
            )}
            {updateAvailable && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-600 dark:text-sky-400">
                <ArrowUpCircle className="h-3 w-3" /> Update
              </span>
            )}
          </div>
          {tagline && <p className="truncate text-sm text-muted-foreground">{tagline}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            title="Open marketing page"
            onClick={() => void onAct(() => suiteCatalog.openMarketing(appId))}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>

          {entry.local.installed && !isCurrentApp && (
            <Button
              variant="ghost"
              size="icon"
              title="Remove from this list"
              onClick={() => void onAct(() => suiteCatalog.markUninstalled(appId))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}

          <PrimaryButton action={primaryAction} onAct={() => onAct(() => suiteCatalog.activate(appId))} />
        </div>
      </CardContent>
    </Card>
  );
}

function PrimaryButton({
  action,
  onAct,
}: {
  action: AppCatalogEntry["primaryAction"];
  onAct: () => Promise<void>;
}) {
  if (action === "current") {
    return (
      <span className={cn("inline-flex items-center gap-1 px-2 text-sm text-muted-foreground")}>
        <Check className="h-4 w-4" /> Installed
      </span>
    );
  }
  if (action === "open") {
    return (
      <Button size="sm" variant="secondary" onClick={() => void onAct()}>
        Open
      </Button>
    );
  }
  if (action === "enroll") {
    return (
      <Button size="sm" variant="outline" onClick={() => void onAct()}>
        Enroll
      </Button>
    );
  }
  return (
    <Button size="sm" onClick={() => void onAct()}>
      <Download className="h-4 w-4" /> Get
    </Button>
  );
}
