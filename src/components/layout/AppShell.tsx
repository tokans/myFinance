import { Suspense, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  LayoutDashboard,
  Wallet,
  Target,
  Receipt,
  Flame,
  LifeBuoy,
  ShieldAlert,
  Settings as SettingsIcon,
  Heart,
  Handshake,
  RotateCw,
  Bug,
  LayoutGrid,
} from "lucide-react";
import { SuiteShell, type SuiteNavItem, type SuiteAction } from "sharedcorelib/ui";
import { openExternal } from "@/lib/openExternal";
import { ReportIssueDialog } from "@/components/feedback/ReportIssueDialog";
import { DonateDialog } from "@/components/feedback/DonateDialog";
import { EmergencyOverlay } from "@/components/emergency/EmergencyOverlay";
import { useGatingStore } from "@/stores/gating.store";
import { useTierStore } from "@/stores/tier.store";
import { useMemberStore } from "@/stores/member.store";
import { becomePatronVisible } from "@/lib/gamification";
import { openPartnerSignup } from "@/lib/donate";
import { buildUserSwitch } from "@/lib/multiuser";
import { FEATURE_GATES, type FeatureKey } from "@/lib/featureGate";

interface NavDef {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** When set, the item shows a lock until its feature gate is satisfied. */
  feature?: FeatureKey;
}

const NAV: NavDef[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/tax", label: "Tax", icon: Receipt, feature: "tax" },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/fire", label: "FIRE", icon: Flame, feature: "fire" },
  { to: "/estate", label: "Emergency Planning", icon: ShieldAlert, feature: "emergency" },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

// The central Menu sheet hosts the primary feature pages (everything but Dashboard + Settings).
const CENTRAL_ROUTES = new Set(["/accounts", "/tax", "/goals", "/fire", "/estate"]);

export function AppShell() {
  const [reportOpen, setReportOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const gating = useGatingStore();
  const refreshGating = useGatingStore((s) => s.refresh);
  const patron = useTierStore((s) => s.patron);
  const tierCtx = useTierStore((s) => s.ctx);
  const refreshTier = useTierStore((s) => s.refresh);
  const scanForGrants = useTierStore((s) => s.scanForGrants);
  const members = useMemberStore((s) => s.members);
  const currentMember = useMemberStore((s) => s.current);
  const setCurrentMember = useMemberStore((s) => s.setCurrent);
  const refreshMembers = useMemberStore((s) => s.refresh);

  // Keep feature-lock indicators current: load on mount and re-check whenever the route changes.
  useEffect(() => { void refreshGating(); }, [refreshGating, location.pathname]);
  useEffect(() => { void refreshTier(); }, [refreshTier, location.pathname]);
  // Multi-user: load the switchable member list once (re-resolves after family changes
  // land via MLA). Free single-user resolves to ≤ 1 member → no switcher renders.
  useEffect(() => { void refreshMembers(); }, [refreshMembers]);

  // Hidden usage screen: Ctrl+Shift+Alt+1.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.altKey && (e.code === "Digit1" || e.key === "1")) {
        e.preventDefault();
        navigate("/usage");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  // The single Patron/Partner call-to-action, resolved from donation state.
  const patronCta = ((): { label: string; icon: typeof Heart; onClick: () => void } => {
    if (!patron.isPatron && patron.pending) {
      return { label: "Restart after Donation", icon: RotateCw, onClick: () => void scanForGrants() };
    }
    if (patron.isPatron && patron.partnerOfferActive) {
      return { label: "Become a Partner", icon: Handshake, onClick: () => void openPartnerSignup() };
    }
    if (patron.isPatron) {
      // Patron, but the 3-month Partner window has closed — re-offer via re-donation.
      return { label: "Reopen Partner signup", icon: Handshake, onClick: () => setDonateOpen(true) };
    }
    return { label: "Become a Patron", icon: Heart, onClick: () => setDonateOpen(true) };
  })();
  // Hide the Patron/Partner CTA until the user reaches the 2nd earned tier (Regular).
  const showPatronCta = patron.isPatron || patron.pending || becomePatronVisible(tierCtx);

  const isLocked = (item: NavDef) =>
    item.feature != null && !FEATURE_GATES[item.feature].isUnlocked(gating);

  const nav: SuiteNavItem[] = NAV.map((it) => {
    const locked = isLocked(it);
    return {
      to: it.to,
      label: it.label,
      icon: it.icon,
      home: it.to === "/",
      end: it.to === "/",
      state: locked ? "nudge" : "open",
      lockHint: locked && it.feature ? FEATURE_GATES[it.feature].unlockHint : undefined,
    };
  });

  // Multi-user switch affordance — PAID-GATED (decision 15): mounted only when the paid
  // entitlement is active AND there is more than one member. The free single-primary-user
  // case yields `undefined`, so the shell chrome is pixel-identical to pre-K4 (invariant 3).
  // Member management itself lives in myLifeAssistant; this app only switches between
  // existing members. The current paid signal in myFinance is Patron/Partner.
  const userSwitch = buildUserSwitch({
    entitled: patron.isPatron || patron.isPartner,
    members,
    current: currentMember,
    onSwitch: setCurrentMember,
  });

  const centralActions: SuiteAction[] = NAV.filter((it) => CENTRAL_ROUTES.has(it.to)).map((it) => ({
    key: it.to,
    label: it.label,
    icon: it.icon,
    to: it.to,
  }));

  // Suite-standard secondary actions (More drawer + desktop sidebar footer). "More Apps"
  // and "Report an issue" used to be SuiteShell chrome props (moreAppsTo/onReportIssue);
  // the K0 SuiteShell API dropped those, so they are now explicit actions (mirrors myHealth).
  const actions: SuiteAction[] = [
    ...(showPatronCta
      ? [{ key: "patron", label: patronCta.label, icon: patronCta.icon, onSelect: patronCta.onClick, tone: "primary" as const }]
      : []),
    { key: "emergency", label: "Press during Emergency", icon: LifeBuoy, onSelect: () => setEmergencyOpen(true), tone: "danger" },
    { key: "more-apps", label: "More Apps", icon: LayoutGrid, to: "/suite" },
    { key: "report", label: "Report an issue", icon: Bug, onSelect: () => setReportOpen(true) },
  ];

  return (
    <>
      <SuiteShell
        brand={
          <>
            <Wallet className="h-5 w-5 text-primary" />
            myFinance
          </>
        }
        nav={nav}
        centralActions={centralActions}
        centralLabel="Menu"
        actions={actions}
        userSwitch={userSwitch}
        sidebarTop={<p className="-mt-2 px-4 pb-1 text-xs text-muted-foreground">Personal · Offline</p>}
        onExternal={(href) => void openExternal(href)}
      >
        {/* Router outlet. Routes are code-split (React.lazy) in App.tsx; the
            Suspense boundary lives here — inside the shell — so route loads show
            a minimal spinner in the content area without flashing the chrome. */}
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </SuiteShell>

      <ReportIssueDialog open={reportOpen} onOpenChange={setReportOpen} />
      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
      <EmergencyOverlay open={emergencyOpen} onOpenChange={setEmergencyOpen} />
    </>
  );
}
