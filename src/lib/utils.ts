/**
 * `cn` (clsx + tailwind-merge) now lives in the shared core (`sharedcorelib/ui`);
 * re-export shim so existing `@/lib/utils` import sites stay unchanged.
 * See [[project_shared_core_extracted]].
 */
export { cn } from "sharedcorelib/ui";
export type { ClassValue } from "sharedcorelib/ui";
