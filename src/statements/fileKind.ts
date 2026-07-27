/**
 * Re-export shim: file-kind sniffing moved to `sharedcorelib/docintake`.
 * Nothing about "a .xlsx is really a zip, an encrypted .xlsx and a legacy
 * .xls are both OLE/CFB" is specific to finance, so every suite app that
 * accepts an uploaded document needs the same logic.
 */
export { detectFileKind, type FileKind } from "sharedcorelib/docintake";
