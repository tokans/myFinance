/**
 * Re-export shim: the parse log now lives in `sharedcorelib/docintake`, which
 * is what writes most of its entries and is shared by every suite app that
 * reads documents.
 *
 * Kept as a shim rather than rewritten at its ~30 call sites — the import path
 * is incidental to those callers, and churning them all would bury the actual
 * pipeline change in noise.
 */
export { createParseLog, type ParseLog, type ParseLogEntry } from "sharedcorelib/docintake";
