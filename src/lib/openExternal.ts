import { isTauri } from "@/lib/environment";

/**
 * Open an external URL in the user's default browser.
 * In Tauri the webview can't navigate to external origins, so we hand off to the
 * OS via the opener plugin; in `npm run dev` (browser) we fall back to window.open.
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
