/**
 * Baked suite trust anchor + the publisher's app registry seed.
 *
 * The suite update manager and app marketplace MECHANISMS live in the shared core
 * (`sharedcorelib/suite`). This file holds myFinance's PER-APP suite config: the
 * signed-feed location, the immutable trust anchor (root + role-delegated keys), the
 * transport key, and a baked seed of the publisher's apps so the marketplace renders
 * something useful before the first signed registry arrives over the air.
 *
 * The keys below are PLACEHOLDERS. Until they're replaced with the real values
 * (printed by the publisher's `suite:keys` tooling), every signature check fails
 * closed and NOTHING is ever applied — the safe default, identical to the masters
 * OTA track (`src/masters/verify.ts`). The marketplace still works off the baked
 * seed; only the *over-the-air* registry/runtime/app updates are gated on real keys.
 */
import type { TrustAnchor, PublishedApp } from "sharedcorelib/suite";

/** This app's stable suite id — flags the current row in the marketplace. */
export const SUITE_APP_ID = "myfinance";

/** Rolling release tag that always holds the newest signed suite metadata + targets. */
export const SUITE_FEED_BASE_URL =
  "https://github.com/tokans/myFinance/releases/download/suite-latest";

/**
 * G4 — publisher trust-anchor key slots. PASTE the REAL public keys from the offline
 * root→roles ceremony here, ONE per role. Each constant maps 1:1 to a field in
 * `publisher.trust.json`, and the hex MUST be byte-identical across both files:
 *
 *   ROOT_PUBKEY_HEX      → publisher.trust.json  root.publicKeyHex
 *   DATA_PUBKEY_HEX      → delegations.data.publicKeyHex
 *   CODE_PUBKEY_HEX      → delegations.code.publicKeyHex      (high-value; 2-of-n threshold)
 *   SNAPSHOT_PUBKEY_HEX  → delegations.snapshot.publicKeyHex
 *   TIMESTAMP_PUBKEY_HEX → delegations.timestamp.publicKeyHex
 *   SUITE_TRANSPORT_KEY_B64 (below) → keep secret half offline
 *
 * publisher-ci `key-separation` requires every role to be a DISTINCT key, all delegated
 * by the immutable root. Until replaced, all-zero ⇒ every signature check fails closed
 * (the G4 deploy gate blocks while any all-zero placeholder remains).
 */
const ROOT_PUBKEY_HEX =
  "1263032bfd81dcc63ad7971b580a0eb058b4490ea9e43a59b4610ea46d1eaa82";
const DATA_PUBKEY_HEX =
  "112a70aa781c0cdff5528c4283e95a8a5d180f6ce35b1cf7ea0bbfdd34d5a052";
const CODE_PUBKEY_HEX =
  "e446a0fa35cd988d426c0879f262939db63d2a6ee1b6fe5f6bc635148ba4d6e1";
const SNAPSHOT_PUBKEY_HEX =
  "afb782e4a93cd7b3583ab7ad4dbce64667e0d52bfaa55d9e245852a8272269a8";
const TIMESTAMP_PUBKEY_HEX =
  "0446856eba222a2721372b4d8f93de16392cfff7b691ec0dcddf7122050e0ffd";

/** Baked AES-256 transport key (32 bytes, base64) for encrypted targets. */
export const SUITE_TRANSPORT_KEY_B64 = "vZnErGJvw7/3F85SGbDMimF4BxBtzmCi2S5qAWED4NQ=";

/**
 * The immutable, offline-root trust anchor. Each role (data/code/snapshot/timestamp)
 * is a separate key delegated by the root — code is verified with the CODE key, never
 * the data key. A delegation that doesn't declare `signedByRoot` is rejected by the
 * core. All placeholders for now → fail-closed.
 */
export const SUITE_TRUST_ANCHOR: TrustAnchor = {
  root: {
    keyId: "tokans-root-v1",
    algo: "ed25519",
    publicKeyHex: ROOT_PUBKEY_HEX,
    offline: true,
    immutable: true,
  },
  delegations: {
    data: { keyId: "tokans-data-v1", algo: "ed25519", publicKeyHex: DATA_PUBKEY_HEX, signedByRoot: true },
    code: { keyId: "tokans-code-v1", algo: "ed25519", publicKeyHex: CODE_PUBKEY_HEX, signedByRoot: true, threshold: 2 },
    snapshot: { keyId: "tokans-snapshot-v1", algo: "ed25519", publicKeyHex: SNAPSHOT_PUBKEY_HEX, signedByRoot: true },
    timestamp: { keyId: "tokans-timestamp-v1", algo: "ed25519", publicKeyHex: TIMESTAMP_PUBKEY_HEX, signedByRoot: true, maxExpiryDays: 7 },
  },
  feed: { baseUrl: SUITE_FEED_BASE_URL, anchorSource: "baked" },
};

/**
 * Baked seed of the publisher's apps. The signed over-the-air `registry` target
 * (when it arrives) overrides this; until then the marketplace lists these so a user
 * can already discover siblings. `latestVersion` is intentionally "0.0.0" so no
 * spurious "update available" shows until the real registry supplies true versions.
 * Download/marketing hosts here stay within the opener/http capability allowlist
 * (github.com/tokans/* and tokans.org/*).
 */
export const SEED_PUBLISHED_APPS: PublishedApp[] = [
  {
    appId: SUITE_APP_ID,
    name: "myFinance",
    tagline: "Private, local-first personal finance",
    description: "Net worth, goals, tax, FIRE and family-readiness — all on your device.",
    marketingUrl: "https://www.tokans.org/apps/myfinance",
    downloadLinks: {
      windows: "https://github.com/tokans/myFinance/releases/latest",
      macos: "https://github.com/tokans/myFinance/releases/latest",
      linux: "https://github.com/tokans/myFinance/releases/latest",
    },
    latestVersion: "0.0.0",
    latestCoreVersion: "0.0.0",
    access: "open",
  },
  {
    appId: "myhealth",
    name: "myHealth",
    tagline: "Your family's private health record",
    description: "Conditions, medications and ICE cards, encrypted on your device.",
    marketingUrl: "https://www.tokans.org/apps/myhealth",
    downloadLinks: {
      windows: "https://github.com/tokans/myHealth/releases/latest",
      macos: "https://github.com/tokans/myHealth/releases/latest",
      linux: "https://github.com/tokans/myHealth/releases/latest",
    },
    latestVersion: "0.0.0",
    latestCoreVersion: "0.0.0",
    access: "open",
  },
  {
    appId: "myworkassistant",
    name: "myWorkAssistant",
    tagline: "For professionals in the partner directory",
    description: "The practice companion for doctors, lawyers and CAs enrolled as partners.",
    marketingUrl: "https://www.tokans.org/apps/myworkassistant",
    enrollUrl: "https://www.tokans.org/partner",
    downloadLinks: {
      windows: "https://github.com/tokans/myWorkAssistant/releases/latest",
      macos: "https://github.com/tokans/myWorkAssistant/releases/latest",
      linux: "https://github.com/tokans/myWorkAssistant/releases/latest",
    },
    latestVersion: "0.0.0",
    latestCoreVersion: "0.0.0",
    access: "partner",
    hasBackend: true,
  },
];
