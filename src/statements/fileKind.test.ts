import { describe, expect, it } from "vitest";
import { detectFileKind } from "./fileKind";

describe("detectFileKind", () => {
  it("detects a PDF by magic bytes", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
    expect(detectFileKind(bytes, "anything.bin")).toBe("pdf");
  });

  it("detects a zip archive by magic bytes when the extension is .zip", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(detectFileKind(bytes, "AIS.zip")).toBe("zip");
  });

  it("detects a plain .xlsx (also a PK zip container) via the extension", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(detectFileKind(bytes, "statement.xlsx")).toBe("xlsx");
  });

  it("detects an encrypted .xlsx (OLE/CFB container) via the extension", () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
    expect(detectFileKind(bytes, "statement.xlsx")).toBe("xlsx");
  });

  it("detects a legacy .xls (OLE/CFB container, encrypted or not) via the extension", () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
    expect(detectFileKind(bytes, "statement.xls")).toBe("xls");
  });

  it("falls back to the extension when bytes are too short to sniff", () => {
    expect(detectFileKind(new Uint8Array([]), "statement.pdf")).toBe("pdf");
  });

  it("returns unknown for an unrecognized file", () => {
    expect(detectFileKind(new Uint8Array([0x00, 0x01]), "mystery.dat")).toBe("unknown");
  });
});
