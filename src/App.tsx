import { lazy, useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
// Dashboard is the index route — keep it eagerly imported so the landing screen
// paints without an extra round-trip. Every other route is code-split (lazy)
// below so its JS (and heavy deps like xlsx/recharts) stays off first-load.
import { DashboardPage } from "@/pages/Dashboard";
const AccountsPage = lazy(() => import("@/pages/Accounts").then((m) => ({ default: m.AccountsPage })));
const AccountDetailPage = lazy(() => import("@/pages/AccountDetail").then((m) => ({ default: m.AccountDetailPage })));
const MonthlyUpdatePage = lazy(() => import("@/pages/MonthlyUpdate").then((m) => ({ default: m.MonthlyUpdatePage })));
const ChangesPage = lazy(() => import("@/pages/Changes").then((m) => ({ default: m.ChangesPage })));
const TaxPage = lazy(() => import("@/pages/Tax").then((m) => ({ default: m.TaxPage })));
const TaxImportPage = lazy(() => import("@/pages/TaxImport").then((m) => ({ default: m.TaxImportPage })));
const AisImportPage = lazy(() => import("@/pages/AisImport").then((m) => ({ default: m.AisImportPage })));
const TdsDocumentImportPage = lazy(() => import("@/pages/TdsDocumentImport").then((m) => ({ default: m.TdsDocumentImportPage })));
const Form16ImportPage = lazy(() => import("@/pages/Form16Import").then((m) => ({ default: m.Form16ImportPage })));
const CategoryDocumentImportPage = lazy(() => import("@/pages/CategoryDocumentImport").then((m) => ({ default: m.CategoryDocumentImportPage })));
const ItReturnImportPage = lazy(() => import("@/pages/ItReturnImport").then((m) => ({ default: m.ItReturnImportPage })));
const CapitalGainsImportPage = lazy(() => import("@/pages/CapitalGainsImport").then((m) => ({ default: m.CapitalGainsImportPage })));
const CaComputationImportPage = lazy(() => import("@/pages/CaComputationImport").then((m) => ({ default: m.CaComputationImportPage })));
const TaxFolderImportPage = lazy(() => import("@/pages/TaxFolderImport").then((m) => ({ default: m.TaxFolderImportPage })));
const CaComputationReconPage = lazy(() => import("@/pages/CaComputationRecon").then((m) => ({ default: m.CaComputationReconPage })));
const TaxReturnPage = lazy(() => import("@/pages/TaxReturn").then((m) => ({ default: m.TaxReturnPage })));
const TaxWizardPage = lazy(() => import("@/pages/TaxWizard").then((m) => ({ default: m.TaxWizardPage })));
const TaxDetailPage = lazy(() => import("@/pages/TaxDetail").then((m) => ({ default: m.TaxDetailPage })));
const ImportPage = lazy(() => import("@/pages/Import").then((m) => ({ default: m.ImportPage })));
const StatementPdfImportPage = lazy(() => import("@/pages/StatementPdfImport").then((m) => ({ default: m.StatementPdfImportPage })));
const TransactionsPage = lazy(() => import("@/pages/Transactions").then((m) => ({ default: m.TransactionsPage })));
const TransactionMatchesPage = lazy(() => import("@/pages/TransactionMatches").then((m) => ({ default: m.TransactionMatchesPage })));
const SftCrossCheckPage = lazy(() => import("@/pages/SftCrossCheck").then((m) => ({ default: m.SftCrossCheckPage })));
const ReconciliationPage = lazy(() => import("@/pages/Reconciliation").then((m) => ({ default: m.ReconciliationPage })));
const ExportPage = lazy(() => import("@/pages/Export").then((m) => ({ default: m.ExportPage })));
const SyncPage = lazy(() => import("@/pages/Sync").then((m) => ({ default: m.SyncPage })));
const GoalsPage = lazy(() => import("@/pages/Goals").then((m) => ({ default: m.GoalsPage })));
const PeoplePage = lazy(() => import("@/pages/People").then((m) => ({ default: m.PeoplePage })));
const RemindersPage = lazy(() => import("@/pages/Reminders").then((m) => ({ default: m.RemindersPage })));
const EmergenciesPage = lazy(() => import("@/pages/Emergencies").then((m) => ({ default: m.EmergenciesPage })));
const EstatePage = lazy(() => import("@/pages/Estate").then((m) => ({ default: m.EstatePage })));
const HealthPage = lazy(() => import("@/pages/Health").then((m) => ({ default: m.HealthPage })));
const InsurancePage = lazy(() => import("@/pages/Insurance").then((m) => ({ default: m.InsurancePage })));
const NomineesPage = lazy(() => import("@/pages/Nominees").then((m) => ({ default: m.NomineesPage })));
const WillPage = lazy(() => import("@/pages/Will").then((m) => ({ default: m.WillPage })));
const IncapacityPage = lazy(() => import("@/pages/Incapacity").then((m) => ({ default: m.IncapacityPage })));
const LiquidityPage = lazy(() => import("@/pages/Liquidity").then((m) => ({ default: m.LiquidityPage })));
const AccessPage = lazy(() => import("@/pages/Access").then((m) => ({ default: m.AccessPage })));
const ReviewPage = lazy(() => import("@/pages/Review").then((m) => ({ default: m.ReviewPage })));
const FamilyPackPage = lazy(() => import("@/pages/FamilyPack").then((m) => ({ default: m.FamilyPackPage })));
const RegisterExportPage = lazy(() => import("@/pages/RegisterExport").then((m) => ({ default: m.RegisterExportPage })));
const FireCalculatorPage = lazy(() => import("@/pages/Fire").then((m) => ({ default: m.FireCalculatorPage })));
const SettingsPage = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })));
const SuitePage = lazy(() => import("@/pages/Suite").then((m) => ({ default: m.SuitePage })));
const UsagePage = lazy(() => import("@/pages/Usage").then((m) => ({ default: m.UsagePage })));
import { FeatureGuard } from "@/components/layout/FeatureGuard";
import { RemountOnNavigate } from "@/hooks/useQueuedDocumentImport";
import { useSettingsStore } from "@/stores/settings.store";
import { runReminderSweep } from "@/lib/reminderSweep";
import { isTauri } from "@/lib/environment";
import { recordLaunch } from "@/db/usage";
import { initSharedDb } from "@/db/sharedDb";
import { useTierStore } from "@/stores/tier.store";
import { useVaultStore } from "@/stores/vault.store";
import { DEMO_MODE, DEMO_MASTER_PASSWORD } from "@/lib/demoMode";

function useThemeApplier() {
  const theme = useSettingsStore((s) => s.settings.theme);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const dark = theme === "dark" || (theme === "system" && prefersDark);
      root.classList.toggle("dark", dark);
    };
    apply();
    if (theme === "system") {
      const m = window.matchMedia("(prefers-color-scheme: dark)");
      m.addEventListener("change", apply);
      return () => m.removeEventListener("change", apply);
    }
  }, [theme]);
}

// Record at most one launch per loaded app session. StrictMode double-invokes
// effects in dev, so a module-level guard keeps it to a single row.
let launchRecorded = false;

// Run non-critical startup work after the first paint so it doesn't contend
// with the main thread while the webview is still becoming interactive
// (this is the window where Android logs "Skipped frames"). Falls back to a
// short timeout where requestIdleCallback is unavailable.
function onIdle(fn: () => void): () => void {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(fn, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const t = setTimeout(fn, 200);
  return () => clearTimeout(t);
}

export default function App() {
  const hydrate = useSettingsStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  // Demo-capture mode only: auto-unlock the credential vault so scenarios that
  // touch credentials run unattended. Gated on DEMO_MODE → no-op in real builds.
  useEffect(() => {
    if (!DEMO_MODE || !isTauri()) return;
    void useVaultStore
      .getState()
      .unlockVault(DEMO_MASTER_PASSWORD)
      .catch((e) => console.error("demo vault unlock failed:", e));
  }, []);
  // All of the below is non-critical startup work (reminders, usage logging,
  // background reference-data pull, donation-file scan). None of it is needed
  // for first paint, so defer it to idle to keep the main thread free while
  // the webview is becoming interactive.
  useEffect(() => {
    return onIdle(() => {
      // Refresh derived reminders and raise an OS notification for anything due.
      // Best-effort; failures (browser mode, no permission) are swallowed inside.
      void runReminderSweep();
      // Log this launch for the usage screen / engagement tier. Best-effort.
      if (isTauri() && !launchRecorded) {
        launchRecorded = true;
        void recordLaunch().catch((e) => console.error("Failed to record launch:", e));
      }
      // Once-a-day background pull of signed master/partner reference data.
      // Non-blocking and fail-silent; applies in place and refreshes open pickers.
      // Dynamically imported INSIDE the idle callback so the Ed25519/masters-verify
      // code (~158 kB gz) leaves first-load entirely. Same call, same timing.
      void import("@/masters/updates").then(({ runMasterUpdateCheck }) =>
        runMasterUpdateCheck(),
      );
      // Once-a-day suite update check (shared runtime + registry + app versions).
      // Native-confirmed, fail-silent, and fail-closed until real publisher keys exist.
      void import("@/suite/updater").then(({ runSuiteUpdateCheck }) =>
        runSuiteUpdateCheck(),
      );
      // Register myFinance's schemas into the shared suite DB (append-only, idempotent,
      // fail-silent). Conflicts are caught here and surfaced at build time by publisher-ci.
      void initSharedDb();
      // Check the Downloads folder for Patron/Partner grant files and load them if
      // present. Fail-silent (falls back to a plain refresh of tier state).
      const { scanForGrants, refresh } = useTierStore.getState();
      void scanForGrants().then((applied) => {
        if (!applied) void refresh();
      });
    });
  }, []);
  useThemeApplier();

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="accounts/:id" element={<AccountDetailPage />} />
          <Route path="update" element={<MonthlyUpdatePage />} />
          <Route path="changes" element={<ChangesPage />} />
          <Route path="tax" element={<FeatureGuard feature="tax"><TaxPage /></FeatureGuard>} />
          <Route path="tax/folder-import" element={<TaxFolderImportPage />} />
          <Route path="tax/import" element={<RemountOnNavigate><TaxImportPage /></RemountOnNavigate>} />
          <Route path="tax/ais" element={<AisImportPage />} />
          <Route path="tax/ais-pdf" element={<RemountOnNavigate><CategoryDocumentImportPage variant="ais" /></RemountOnNavigate>} />
          <Route path="tax/tis-pdf" element={<RemountOnNavigate><CategoryDocumentImportPage variant="tis" /></RemountOnNavigate>} />
          <Route path="tax/26as" element={<RemountOnNavigate><TdsDocumentImportPage /></RemountOnNavigate>} />
          <Route path="tax/form16" element={<RemountOnNavigate><Form16ImportPage /></RemountOnNavigate>} />
          <Route path="tax/it-return" element={<RemountOnNavigate><ItReturnImportPage /></RemountOnNavigate>} />
          <Route path="tax/capital-gains" element={<RemountOnNavigate><CapitalGainsImportPage /></RemountOnNavigate>} />
          <Route path="tax/ca-computation" element={<RemountOnNavigate><CaComputationImportPage /></RemountOnNavigate>} />
          <Route path="tax/wizard" element={<TaxWizardPage />} />
          <Route path="tax/:ay/return" element={<TaxReturnPage />} />
          <Route path="tax/:ay/sft" element={<SftCrossCheckPage />} />
          <Route path="tax/:ay/recon" element={<ReconciliationPage />} />
          <Route path="tax/:ay/ca-recon" element={<CaComputationReconPage />} />
          <Route path="tax/:ay" element={<TaxDetailPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="import/statement-pdf" element={<RemountOnNavigate><StatementPdfImportPage /></RemountOnNavigate>} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="transactions/matches" element={<TransactionMatchesPage />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="sync" element={<FeatureGuard feature="sync"><SyncPage /></FeatureGuard>} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="reminders" element={<RemindersPage />} />
          <Route path="emergencies" element={<EmergenciesPage />} />
          <Route path="estate" element={<FeatureGuard feature="emergency"><EstatePage /></FeatureGuard>} />
          <Route path="estate/health" element={<HealthPage />} />
          <Route path="estate/insurance" element={<InsurancePage />} />
          <Route path="estate/nominees" element={<NomineesPage />} />
          <Route path="estate/will" element={<WillPage />} />
          <Route path="estate/incapacity" element={<IncapacityPage />} />
          <Route path="estate/liquidity" element={<LiquidityPage />} />
          <Route path="estate/access" element={<AccessPage />} />
          <Route path="estate/review" element={<ReviewPage />} />
          <Route path="estate/family-pack" element={<FamilyPackPage />} />
          <Route path="estate/register" element={<RegisterExportPage />} />
          <Route path="fire" element={<FeatureGuard feature="fire"><FireCalculatorPage /></FeatureGuard>} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="suite" element={<SuitePage />} />
          <Route path="usage" element={<UsagePage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
