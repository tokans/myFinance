# Patron & Partner — donation flow and tier reference

How myFinance turns a donation into the **Patron** tier (and the 3-month
**Partner** offer), how the donation file is produced, and how to take it live.

The app is client-only with no backend, so a donation (or pro enrollment) can't be
verified by a server callback. Instead, after the event tokans.org **hands the user
a signed + encrypted grant file**; they drop it in their Downloads folder and the
app loads it on the next launch. Both Patron and Partner ride the same shared
receive-only **grant handoff** (`sharedcorelib/grant`), distinguished by the grant's
`kind` field. The construction mirrors the masters OTA pipeline (encrypt-then-sign,
verify-before-decrypt) — see [master-and-app-updates.md](plans/master-and-app-updates.md).

## Tiers

| Tier | Reached when |
|------|--------------|
| Newcomer | always |
| Regular | opened on 7 distinct days **OR** 3 months of data recorded |
| Expert | opened on 20 distinct days **AND** every feature used once (data-presence: accounts, snapshots, goals, emergency action, a tax year) |
| **Patron** | a valid Patron grant file has been loaded (permanent). Outranks Expert — a Regular who donates jumps straight to Patron |
| **Partner** | a valid Partner grant file has been loaded (`partner_since`). Outranks (implies) Patron |

Definitions live in [src/lib/gamification.ts](../src/lib/gamification.ts); the live
values are assembled in [src/stores/tier.store.ts](../src/stores/tier.store.ts).

## Button behaviour (shell, above "Report an issue")

| State | Button | Action |
|-------|--------|--------|
| Not Patron, not pending | **Become a Patron** | opens the donate dialog → `tokans.org/donate` |
| Donation page opened, no file yet | **Restart after Donation** | re-scans Downloads on click (a restart also triggers the scan) |
| Patron, within 3 months of donation | **Become a Partner** | opens `tokans.org/professionals/signup`; the resulting Partner grant loads on the next restart |
| Patron, past 3 months | **Reopen Partner signup** | re-donate to refresh the window |

State is persisted in the settings key-value table (no migration): `patron_since`
(= donation date, permanent), `patron_pending`, `partner_since` (= enrollment date,
permanent). See [src/lib/patron.ts](../src/lib/patron.ts).

## Grant files

- **Filenames (fixed):** `myfinance-patron.tokans` (Patron) and
  `myfinance-partner.tokans` (Partner), saved in the user's Downloads folder. The
  app reads exactly these two known paths — it never lists the folder.
- **Format** (see [src/lib/patronFile.ts](../src/lib/patronFile.ts)):
  - Envelope JSON: `{ "v": 1, "enc": "<base64>", "sig": "<base64>" }`
  - `enc` = base64 of `iv(12) || AES-256-GCM ciphertext || tag(16)` over the
    payload `{ "kind": "patron"|"partner", "since": "YYYY-MM-DD", "issuedAt"?: "...", "note"?: "..." }`
  - `sig` = base64 Ed25519 detached signature over the decoded `enc` bytes
  - The file is only accepted for the channel whose name matches its `kind`.
- **Keys** are SEPARATE from the masters keys (grant files are generated
  automatically, so the signing key lives online — never the offline masters key).
  The baked values in `patronFile.ts` are fail-closed placeholders (all-zero ⇒
  every file is rejected) until the real ones are set.

## Generating files — `scripts/make-patron-file.ts`

```bash
# one-time: create the patron keypair + transport key under .keys/
# (prints the PATRON_PUBKEY_HEX / PATRON_TRANSPORT_KEY_B64 to bake in)
npm run patron:keys

# make a Patron grant for a donation on a given date (default: today)
npm run patron:make -- --date 2026-06-01

# make a Partner grant instead (writes myfinance-partner.tokans)
npm run patron:make -- --kind partner --date 2026-06-01 --downloads

# drop it straight into ~/Downloads to test the running app
npm run patron:make -- --date 2026-06-01 --downloads

# custom output path / optional note
npm run patron:make -- --date 2026-06-01 --out ./tmp/p.tokans --note "Thank you!"
```

Keys are read from `$PATRON_PRIVATE_KEY_PEM` / `$PATRON_TRANSPORT_KEY`, falling
back to `.keys/patron-ed25519.private.pem` and `.keys/patron-transport.key`.
Both `.keys/` and `dist-patron/` are git-ignored.

## Going live (checklist)

1. `npm run patron:keys` once on a trusted machine.
2. Paste the printed `PATRON_PUBKEY_HEX` and `PATRON_TRANSPORT_KEY_B64` into
   [src/lib/patronFile.ts](../src/lib/patronFile.ts) (replacing the placeholders)
   and ship a build.
3. Put the **same** private + transport keys on the tokans.org side. After a
   successful Razorpay payment, run the file-creation step (or the equivalent
   server code) with that donor's `--date` and email the resulting
   `myfinance-patron.tokans` as an attachment.
4. The email should tell the donor to save the attachment to **Downloads** under
   that exact name and restart the app.

## Tests

- [src/lib/patronFile.test.ts](../src/lib/patronFile.test.ts) — verify/decrypt
  round-trip for both kinds, wrong-key / tamper / bad-payload / bad-kind rejection,
  fail-closed placeholders.
- [src/lib/patron.test.ts](../src/lib/patron.test.ts) — the 3-month Partner
  window math.

Run with `npm test`.
