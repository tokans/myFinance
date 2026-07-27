/**
 * topBar.store — lets a page inject its chrome into the suite shell's top bar. React
 * Router's `<Outlet/>` has no child-to-layout prop channel, so a page sets/clears this
 * store (mount/unmount effect) and the layout route (AppShell) renders what's current.
 *
 * Two slots:
 *   - `center` — the page heading + actions row, fed to `SuiteShell`'s `topBarCenter`
 *     (shown on desktop AND mobile — the shell's `topBarCenterOnMobile` is on).
 *   - `back` — a back destination. On MOBILE, AppShell renders it as a back arrow in the
 *     top-left, in place of the "myFinance" brand (a native mobile pattern). On desktop
 *     the back arrow lives inline before the title (the sidebar owns the top-left).
 *
 * Pages don't touch this store directly — they render `<PageHeader/>`
 * (`components/layout/PageHeader.tsx`), which calls `usePageTopBar` for them.
 */
import { create } from "zustand";
import { useEffect, type ReactNode } from "react";

export interface TopBarBack {
  to: string;
  label?: string;
}

interface TopBarState {
  center: ReactNode | null;
  back: TopBarBack | null;
  set: (center: ReactNode | null, back: TopBarBack | null) => void;
}

export const useTopBarStore = create<TopBarState>((set) => ({
  center: null,
  back: null,
  set: (center, back) => set({ center, back }),
}));

/**
 * Register a page's top-bar chrome for as long as the caller is mounted (cleared on
 * unmount so the next page doesn't inherit it). `center` is rebuilt each render; the
 * back destination is depended on by value so identity churn doesn't thrash the store.
 * Only AppShell subscribes to these slots, so re-setting them never re-renders the
 * calling page (no feedback loop).
 */
export function usePageTopBar(center: ReactNode | null, back: TopBarBack | null): void {
  const to = back?.to;
  const label = back?.label;
  useEffect(() => {
    useTopBarStore.getState().set(center, to ? { to, label } : null);
    return () => useTopBarStore.getState().set(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, to, label]);
}
