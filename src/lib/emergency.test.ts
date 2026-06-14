import { describe, expect, it } from "vitest";
import { hasActionableContact, mailtoHref, mentionsContact, telHref } from "./emergency";

describe("mentionsContact", () => {
  it("detects call/contact verbs as whole words", () => {
    expect(mentionsContact("Call the RM to claim the FD")).toBe(true);
    expect(mentionsContact("Contact nominee Priya")).toBe(true);
    expect(mentionsContact("Reach out to the branch")).toBe(true);
    expect(mentionsContact("Email the insurer's TPA")).toBe(true);
    expect(mentionsContact("notify spouse")).toBe(true);
  });

  it("does not false-trigger on substrings", () => {
    expect(mentionsContact("Recall the past statements")).toBe(false);
    expect(mentionsContact("Read the information sheet")).toBe(false);
    expect(mentionsContact("Withdraw the balance at maturity")).toBe(false);
  });

  it("handles empty / nullish input", () => {
    expect(mentionsContact("")).toBe(false);
    expect(mentionsContact(null)).toBe(false);
    expect(mentionsContact(undefined)).toBe(false);
  });
});

describe("telHref", () => {
  it("extracts a dialable number with country code", () => {
    expect(telHref("Priya Sharma (RM) +91 98765 43210")).toBe("tel:+919876543210");
  });

  it("extracts a plain 10-digit number", () => {
    expect(telHref("9876543210")).toBe("tel:9876543210");
  });

  it("ignores short numbers like an account's last 4", () => {
    expect(telHref("A/C ...1234")).toBe(null);
    expect(telHref("Priya")).toBe(null);
    expect(telHref(null)).toBe(null);
  });
});

describe("mailtoHref", () => {
  it("extracts an email", () => {
    expect(mailtoHref("Ask CA ca@example.com about it")).toBe("mailto:ca@example.com");
  });
  it("returns null when there's no email", () => {
    expect(mailtoHref("Call +91 98765 43210")).toBe(null);
  });
});

describe("hasActionableContact", () => {
  it("is true only when an action needs a contact and one exists", () => {
    expect(
      hasActionableContact({ emergency_action: "Call the RM", contact: "+91 98765 43210" }),
    ).toBe(true);
    expect(hasActionableContact({ emergency_action: "Call the RM", contact: null })).toBe(false);
    expect(
      hasActionableContact({ emergency_action: "Balance auto-transfers to nominee", contact: "x" }),
    ).toBe(false);
  });
});
