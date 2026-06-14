/**
 * Environment detection helpers.
 *
 * The implementation now lives in the shared core (`sharedcorelib/env`); this
 * module is a thin re-export shim so existing `@/lib/environment` import sites
 * stay unchanged. See [[project_shared_core_extracted]].
 */
export { isTauri, isWeb, isMobile, isDesktop } from "sharedcorelib/env";
