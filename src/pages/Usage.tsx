import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Flame, Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isTauri } from "@/lib/environment";
import { getLaunchStats, type LaunchStats } from "@/db/usage";
import { resolveTier, nextEarnedTiers } from "@/lib/gamification";
import { useTierStore } from "@/stores/tier.store";

/**
 * Hidden usage screen — reachable only via Ctrl+Shift+Alt+1. Shows every day the
 * app was opened plus the engagement tier those days earn. Local-only data.
 */
export function UsagePage() {
  const [stats, setStats] = useState<LaunchStats | null>(null);
  const [loading, setLoading] = useState(true);
  const tierCtx = useTierStore((s) => s.ctx);
  const refreshTier = useTierStore((s) => s.refresh);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    try {
      setStats(await getLaunchStats());
      await refreshTier();
    } finally {
      setLoading(false);
    }
  }, [refreshTier]);

  useEffect(() => { void refresh(); }, [refresh]);

  const tier = useMemo(() => resolveTier(tierCtx), [tierCtx]);
  const upcoming = useMemo(() => nextEarnedTiers(tierCtx), [tierCtx]);
  const TierIcon = tier.icon;

  return (
    <div className="container max-w-3xl py-6">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Usage</h2>
        <p className="text-sm text-muted-foreground">
          Every day you've opened myFinance. This is stored only on this device.
        </p>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Usage history lives in SQLite — run the desktop app to see it.
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Your tier</CardDescription>
            <CardTitle className={`flex items-center gap-2 text-2xl ${tier.className}`}>
              <TierIcon className="h-6 w-6" /> {tier.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {upcoming.length > 0
              ? `Next: ${upcoming[0].label} — ${upcoming[0].criteria}`
              : tier.key === "partner"
                ? "Top tier reached. 🎉"
                : "All earned tiers reached — support the project to become a Patron."}
          </CardContent>
        </Card>

        <Stat icon={CalendarDays} label="Active days" value={stats?.distinctDays ?? 0} />
        <Stat icon={Activity} label="Total launches" value={stats?.totalLaunches ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Flame className="h-4 w-4" /> Launch history
          </CardTitle>
          <CardDescription>Each day you opened the app, most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : !stats || stats.days.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No launches recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {stats.days.map((d) => (
                <li key={d.day} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>{d.day}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.count} launch{d.count === 1 ? "" : "es"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" /> {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
