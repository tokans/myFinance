import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { T } from "./tables";
import { buildSuiteTestDb } from "./__tests__/suiteTestDb";

// Shared in-memory DB handle the mocked client delegates to. `vi.hoisted` makes
// it visible inside the (hoisted) vi.mock factory below.
const h = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

// Replace the Tauri SQL client with one backed by node:sqlite so the REAL db
// layer (createReminder, syncDerivedReminders, …) runs against a real suite DB
// built from the actual descriptors + aux-SQL (the namespaced myfinance_* tables).
vi.mock("./client", async () => {
  const { T: tables } = await import("./tables");
  return {
    T: tables,
    query: async (sql: string, params: unknown[] = []) =>
      h.db!.prepare(sql).all(...(params as never[])),
    exec: async (sql: string, params: unknown[] = []) => {
      if (params.length) h.db!.prepare(sql).run(...(params as never[]));
      else h.db!.exec(sql);
    },
    getDb: async () => ({
      execute: async (sql: string, params: unknown[] = []) => {
        const r = h.db!.prepare(sql).run(...(params as never[]));
        return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
      },
      select: async (sql: string, params: unknown[] = []) =>
        h.db!.prepare(sql).all(...(params as never[])),
    }),
  };
});

import {
  createReminder, listOpenReminders, syncDerivedReminders,
  completeReminder, snoozeReminder, dismissReminder,
} from "./reminders";
import { createAccount, updateAccount, getAccount, advanceSip, deleteAccount } from "./accounts";
import { addDocumentMetaOnly } from "./documents";
import { createPolicy } from "./insurance";

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

describe("syncDerivedReminders", () => {
  it("creates one reminder per FD maturity, document expiry and policy renewal", async () => {
    await createAccount({ name: "ICICI FD", type: "fixed_deposit", maturity_date: "2026-07-01" });
    await addDocumentMetaOnly({ type: "policy", title: "Term policy", expires_on: "2026-08-01" });
    await createPolicy({ kind: "term", insurer: "LIC", sum_assured: 100, renewal_date: "2026-09-01" });

    const n = await syncDerivedReminders();
    expect(n).toBe(3);

    const open = await listOpenReminders();
    const keys = open.map((r) => r.dedupe_key).sort();
    expect(keys).toEqual(["doc:1", "fd:1", "policy:1"]);
    expect(open.find((r) => r.type === "fd_maturity")!.due_date).toBe("2026-07-01");
  });

  it("is idempotent — re-syncing does not duplicate", async () => {
    await createAccount({ name: "FD", type: "fixed_deposit", maturity_date: "2026-07-01" });
    await syncDerivedReminders();
    await syncDerivedReminders();
    const open = await listOpenReminders();
    expect(open).toHaveLength(1);
  });

  it("preserves a snooze across re-sync", async () => {
    await createAccount({ name: "FD", type: "fixed_deposit", maturity_date: "2026-07-01" });
    await syncDerivedReminders();
    const id = (await listOpenReminders())[0].id;
    await snoozeReminder(id, "2026-06-30");
    await syncDerivedReminders();
    const r = (await listOpenReminders()).find((x) => x.id === id)!;
    expect(r.snoozed_until).toBe("2026-06-30");
  });

  it("prunes a derived reminder when its source date is cleared", async () => {
    const id = await createAccount({ name: "FD", type: "fixed_deposit", maturity_date: "2026-07-01" });
    await syncDerivedReminders();
    expect(await listOpenReminders()).toHaveLength(1);

    // Clear the maturity date, then re-sync.
    const acc = await getAccount(id);
    await updateAccount(id, { name: acc!.name, type: "fixed_deposit", maturity_date: null });
    await syncDerivedReminders();
    expect(await listOpenReminders()).toHaveLength(0);
  });

  it("does not touch manual reminders when pruning derived ones", async () => {
    await createReminder({ title: "Manual", due_date: "2026-12-01" });
    await createAccount({ name: "FD", type: "fixed_deposit", maturity_date: "2026-07-01" });
    await syncDerivedReminders();
    // Remove the FD source so the derived reminder is pruned.
    await syncDerivedReminders(); // FD still there → still 2
    expect(await listOpenReminders()).toHaveLength(2);
  });
});

describe("deleteAccount cleans up its reminders", () => {
  it("removes both derived and manual reminders linked to the deleted account", async () => {
    const id = await createAccount({ name: "FD", type: "fixed_deposit", maturity_date: "2026-07-01" });
    await createReminder({ title: "Linked manual", due_date: "2026-12-01", account_id: id });
    await syncDerivedReminders(); // adds the derived fd:<id> reminder
    expect(await listOpenReminders()).toHaveLength(2);

    await deleteAccount(id);
    expect(await listOpenReminders()).toHaveLength(0);
  });

  it("leaves reminders that belong to other accounts untouched", async () => {
    const keep = await createAccount({ name: "Keep FD", type: "fixed_deposit", maturity_date: "2026-07-01" });
    const drop = await createAccount({ name: "Drop FD", type: "fixed_deposit", maturity_date: "2026-08-01" });
    await syncDerivedReminders();
    expect(await listOpenReminders()).toHaveLength(2);

    await deleteAccount(drop);
    const open = await listOpenReminders();
    expect(open).toHaveLength(1);
    expect(open[0].account_id).toBe(keep);
  });
});

describe("completeReminder", () => {
  it("rolls an annual reminder forward instead of closing it", async () => {
    const id = await createReminder({ title: "Annual review", due_date: "2025-01-01", cadence: "annual" });
    await completeReminder(id, "2026-05-31");
    const open = await listOpenReminders();
    expect(open).toHaveLength(1);
    expect(open[0].due_date).toBe("2027-01-01"); // next future occurrence
  });

  it("closes a one-off reminder", async () => {
    const id = await createReminder({ title: "One off", due_date: "2026-01-01", cadence: "once" });
    await completeReminder(id, "2026-05-31");
    expect(await listOpenReminders()).toHaveLength(0);
  });
});

describe("dismissReminder", () => {
  it("removes a derived reminder from the open list without re-creating it on sync", async () => {
    await createAccount({ name: "FD", type: "fixed_deposit", maturity_date: "2026-07-01" });
    await syncDerivedReminders();
    const id = (await listOpenReminders())[0].id;
    await dismissReminder(id);
    expect(await listOpenReminders()).toHaveLength(0);
    // Re-sync refreshes the same row (still dismissed), does not resurrect it.
    await syncDerivedReminders();
    expect(await listOpenReminders()).toHaveLength(0);
  });
});

describe("SIP reminders", () => {
  it("creates a SIP reminder only within the lead window and keeps it overdue until actioned", async () => {
    const id = await createAccount({
      name: "Index Fund", type: "mutual_funds", sip_day: 12, sip_amount: 5000,
    });

    // 9 days before the 12th → outside the 3-day window → nothing.
    await syncDerivedReminders("2026-06-03");
    expect(await listOpenReminders()).toHaveLength(0);

    // 2 days before → created.
    await syncDerivedReminders("2026-06-10");
    let open = await listOpenReminders();
    expect(open).toHaveLength(1);
    expect(open[0].dedupe_key).toBe(`sip:${id}`);
    expect(open[0].type).toBe("sip");
    expect(open[0].due_date).toBe("2026-06-12");

    // After the date, still unactioned → persists (overdue) at the same due date.
    await syncDerivedReminders("2026-06-20");
    open = await listOpenReminders();
    expect(open).toHaveLength(1);
    expect(open[0].due_date).toBe("2026-06-12");
  });

  it("advanceSip clears the reminder; it reappears only next cycle", async () => {
    const id = await createAccount({ name: "ELSS", type: "mutual_funds", sip_day: 5 });

    await syncDerivedReminders("2026-06-03");
    const open = await listOpenReminders();
    expect(open).toHaveLength(1);

    await advanceSip(id, open[0].due_date); // user swiped Done / Ignore
    expect(await listOpenReminders()).toHaveLength(0);

    // Same cycle re-sync must not resurrect it.
    await syncDerivedReminders("2026-06-04");
    expect(await listOpenReminders()).toHaveLength(0);

    // Next month, within the window → a fresh reminder for the new occurrence.
    await syncDerivedReminders("2026-07-03");
    const next = await listOpenReminders();
    expect(next).toHaveLength(1);
    expect(next[0].due_date).toBe("2026-07-05");
  });

  it("prunes the SIP reminder when the SIP day is cleared", async () => {
    const id = await createAccount({ name: "SIP fund", type: "mutual_funds", sip_day: 5 });
    await syncDerivedReminders("2026-06-03");
    expect(await listOpenReminders()).toHaveLength(1);

    await updateAccount(id, { name: "SIP fund", type: "mutual_funds", sip_day: null });
    await syncDerivedReminders("2026-06-03");
    expect(await listOpenReminders()).toHaveLength(0);
  });
});

describe("tax-deadline reminders", () => {
  it("generates advance-tax + ITR reminders only once tax data exists", async () => {
    // No tax data → no tax reminders.
    await syncDerivedReminders("2026-06-01");
    expect((await listOpenReminders()).filter((r) => r.type === "tax_deadline")).toHaveLength(0);

    h.db!.exec(`INSERT INTO ${T.taxYears} (ay) VALUES ('AY2026-27')`);
    await syncDerivedReminders("2026-06-01");
    const tax = (await listOpenReminders()).filter((r) => r.type === "tax_deadline");
    expect(tax.map((r) => r.dedupe_key).sort()).toEqual([
      "tax:advance_q1", "tax:advance_q2", "tax:advance_q3", "tax:advance_q4", "tax:itr_filing",
    ]);
    expect(tax.find((r) => r.dedupe_key === "tax:itr_filing")!.due_date).toBe("2026-07-31");
    expect(tax.every((r) => r.cadence === "annual")).toBe(true);
  });

  it("rolls a completed tax deadline forward a year and preserves it across re-sync", async () => {
    h.db!.exec(`INSERT INTO ${T.taxYears} (ay) VALUES ('AY2026-27')`);
    await syncDerivedReminders("2026-07-25"); // ITR due 2026-07-31 (future)
    await syncDerivedReminders("2026-08-05"); // same row, now overdue

    const itr = (await listOpenReminders()).find((r) => r.dedupe_key === "tax:itr_filing")!;
    expect(itr.due_date).toBe("2026-07-31");

    await completeReminder(itr.id, "2026-08-05"); // user files → roll forward a year
    let next = (await listOpenReminders()).find((r) => r.dedupe_key === "tax:itr_filing")!;
    expect(next.due_date).toBe("2027-07-31");

    // The lifecycle owns the due date — re-sync must not pull it back to this year.
    await syncDerivedReminders("2026-08-06");
    next = (await listOpenReminders()).find((r) => r.dedupe_key === "tax:itr_filing")!;
    expect(next.due_date).toBe("2027-07-31");
  });
});
