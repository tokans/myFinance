import { useEffect, useState } from "react";
import { isDesktop, isTauri } from "@/lib/environment";

/**
 * Desktop-vs-mobile check for features that are desktop-only regardless of
 * being inside Tauri (e.g. the transaction ledger). `isDesktop()` is async
 * (reads `@tauri-apps/plugin-os`), so this resolves it once per mount.
 * Starts `false` (mobile-shaped UI) until resolved, then flips once known —
 * avoids a desktop-only section flashing before the platform check lands.
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    if (!isTauri()) return; // browser preview: neither desktop nor mobile app
    let cancelled = false;
    void isDesktop().then((d) => { if (!cancelled) setDesktop(d); });
    return () => { cancelled = true; };
  }, []);

  return desktop;
}
