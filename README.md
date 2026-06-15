# myFinance

**Your money, on your machine.** myFinance is a private, offline-first
personal finance tracker. Your data never leaves your device — there is
no account, no cloud, and no server.

🌐 **Website:** [https://tokans.github.io/myFinance/](https://tokans.github.io/myFinance/)

## What it does

- 📊 **Track net worth over time** — monthly snapshots of every account,
  with month-over-month and financial-year trends.
- 📁 **Excel in, Excel out** — import your existing spreadsheet and export
  back to it. Excel stays the source of truth you own.
- 🎯 **Goals & projections** — set targets and see realistic ETAs based on
  your actual saving pace.
- 🧾 **Tax helper** — import official ITR JSON exports and get an advisory
  ITR-form recommendation.
- 🔐 **Encrypted vault** — sensitive account credentials are protected by a
  master password (Argon2id + Stronghold). Nothing is stored in plain text.
- 💱 **Configurable currency & financial year** (January or April start).

## Download

Browse screenshots, the demo, and what's new on the
[project website](https://tokans.github.io/myFinance/), or grab the installer for your platform
from the [latest release](https://github.com/tokans/myFinance/releases/latest):

| Platform | File |
| --- | --- |
| Windows | `.msi` / `.exe` installer |
| macOS (Intel + Apple Silicon) | universal `.dmg` |
| Android (arm64, experimental) | `.apk` (sideload) · `.aab` |
| iOS (experimental) | unsigned build |

All assets for this version are attached to the
[v1.0.3 release](https://github.com/tokans/myFinance/releases/tag/v1.0.3).

> Mobile builds are **experimental and unsigned** for now: the Android
> `.apk` is debug-signed (sideloadable, not production) and iOS is not
> yet code-signed. Production signing is wired up separately.

## Privacy

myFinance has **no backend and no telemetry**. All data lives in a local
SQLite database and an encrypted vault on your own machine.

---

## Release notes — v1.0.3

**Full Changelog**: https://github.com/tokans/myFinance/compare/v1.0.2...v1.0.3

---

_This README is generated automatically on each release._
