import { Link } from "react-router-dom";
import {
  HeartPulse, Shield, Users2, ScrollText, ShieldHalf, Droplets, KeyRound,
  ClipboardCheck, Users, Database, LifeBuoy, BellRing, type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Item { to: string; title: string; desc: string; icon: LucideIcon; }

const SECTIONS: { group: string; items: Item[] }[] = [
  {
    group: "Be ready",
    items: [
      { to: "/emergencies", title: "Prepare for emergencies", desc: "What to do & who to call per account.", icon: LifeBuoy },
      { to: "/estate/health", title: "Health & ICE file", desc: "Grab-and-go medical summary.", icon: HeartPulse },
      { to: "/reminders", title: "Reminders", desc: "Maturities, renewals, reviews.", icon: BellRing },
    ],
  },
  {
    group: "Cover & assign",
    items: [
      { to: "/estate/insurance", title: "Insurance", desc: "Coverage gaps & renewals.", icon: Shield },
      { to: "/estate/nominees", title: "Nominees", desc: "Nominees, shares & holding mode.", icon: Users2 },
      { to: "/estate/liquidity", title: "Joint holdings & liquidity", desc: "Survivor access & emergency fund.", icon: Droplets },
    ],
  },
  {
    group: "Legal",
    items: [
      { to: "/estate/will", title: "Will & legal vault", desc: "Store, version & reconcile your Will.", icon: ScrollText },
      { to: "/estate/incapacity", title: "PoA & incapacity", desc: "Power of Attorney & living will.", icon: ShieldHalf },
    ],
  },
  {
    group: "Handover",
    items: [
      { to: "/people", title: "People", desc: "Family, executor, nominees, doctors.", icon: Users },
      { to: "/estate/access", title: "Trusted access", desc: "Tiers, check-in & encrypted packages.", icon: KeyRound },
      { to: "/estate/family-pack", title: "Family pack", desc: "A 'what-if' briefing document.", icon: Users },
      { to: "/estate/review", title: "Annual review", desc: "Yearly checklist & life events.", icon: ClipboardCheck },
      { to: "/estate/register", title: "Register & export", desc: "Search all assets; encrypted backup.", icon: Database },
    ],
  },
];

export function EstatePage() {
  return (
    <div className="container max-w-4xl py-6">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Estate readiness</h2>
        <p className="text-sm text-muted-foreground">
          Prepare so your family can access assets and make decisions without friction. All data stays
          on this device. This is a planning aid, not legal, financial, or medical advice.
        </p>
      </header>

      <div className="space-y-6" data-testid="estate-hub">
        {SECTIONS.map((section) => (
          <section key={section.group} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{section.group}</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item) => (
                <Link key={item.to} to={item.to}>
                  <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/40">
                    <CardContent className="flex items-start gap-3 p-4">
                      <div className="rounded-md bg-primary/10 p-2 text-primary"><item.icon className="h-5 w-5" /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.desc}</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
