/**
 * Active platform for download-link selection, derived from the webview user-agent
 * (no plugin / capability needed). Android reports "Linux" in its UA, so it is
 * checked first. Returns undefined when unknown — callers fall back to the first
 * available download link.
 */
export function detectPlatform(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return undefined;
}
