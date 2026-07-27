// Re-export shim: the implementation lives in the shared core (`sharedcorelib/env`).
// Kept so existing `@/lib/openExternal` importers don't all have to change.
export { openExternal } from "sharedcorelib/env";
