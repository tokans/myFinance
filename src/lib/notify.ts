/**
 * OS-local notifications via tauri-plugin-notification. The implementation now
 * lives in the shared core (`sharedcorelib/reminders`); re-export shim so existing
 * `@/lib/notify` import sites stay unchanged. Best-effort: any failure (plugin
 * missing, permission denied, browser mode) degrades silently — the in-app
 * reminders inbox is the source of truth. See [[project_shared_core_extracted]].
 */
export { ensureNotificationPermission, sendNotification } from "sharedcorelib/reminders";
