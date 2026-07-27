/**
 * Decrypt an AIS/TIS JSON downloaded from the Income-Tax portal.
 *
 * The portal hands out the AIS as an *encrypted* JSON (the official AIS Utility
 * decrypts it locally). The wire format and crypto are:
 *
 *   text = <IV hex, 32 chars> <salt hex, 32 chars> <ciphertext, base64 or hex>
 *   key  = PBKDF2-HMAC-SHA256(password, salt, iterations=1000, dkLen=32)  // publisher-ci-ignore: kdf-floor
 *   plaintext = AES-256-CBC-decrypt(ciphertext, key, IV) with PKCS#7 padding
 *
 * The password is derived from the filer's PAN + date-of-birth. We try the
 * known constructions (a versioned "middle" segment, then plain lower/upper),
 * plus an explicit override, and accept whichever yields valid UTF-8 JSON.
 *
 * Everything runs in WebCrypto (`crypto.subtle`) — the app's existing crypto
 * substrate — so no new dependency is pulled in. AES-CBC in WebCrypto strips
 * the PKCS#7 padding for us. Receive-only: nothing leaves the device.
 *
 * Reference: https://gist.github.com/theamanbhargava/bded50e43ceec109925198aba9508b96
 */

/** Middle segment used by the AIS Utility's password construction. */
const PASSWORD_MIDDLE = "GQ39%*g";

export interface AisDecryptInputs {
  /** 10-char PAN (case-insensitive; we try both cases). */
  pan: string;
  /** Date of birth. Accepts DDMMYYYY / DD/MM/YYYY / DD-MM-YYYY / YYYY-MM-DD. */
  dob: string;
  /** Explicit full password override; tried first when provided. */
  password?: string;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Normalize a DOB into DDMMYYYY (the AIS password uses this form). */
function toDdmmyyyy(dob: string): string | null {
  const d = dob.trim();
  let m: RegExpMatchArray | null;
  if ((m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${m[3]}${m[2]}${m[1]}`; // YYYY-MM-DD
  if ((m = d.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/))) return `${m[1]}${m[2]}${m[3]}`; // DD/MM/YYYY
  if (/^\d{8}$/.test(d)) return d; // already DDMMYYYY
  return null;
}

/** Candidate passwords, in the order the AIS Utility tries them. */
function candidatePasswords({ pan, dob, password }: AisDecryptInputs): string[] {
  const list: string[] = [];
  if (password && password.trim()) list.push(password);
  const panLower = pan.trim().toLowerCase();
  const panUpper = pan.trim().toUpperCase();
  const dobForms = Array.from(new Set([toDdmmyyyy(dob), dob.trim()].filter((s): s is string => !!s)));
  for (const d of dobForms) {
    list.push(`${panLower}${PASSWORD_MIDDLE}${d}`);
    list.push(`${panLower}${d}`);
    list.push(`${panUpper}${d}`);
  }
  return Array.from(new Set(list));
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const pwKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"],
  );
  return crypto.subtle.deriveKey(
    // 1000 iterations is READ-ONLY INTEROP, not a parameter this app chooses: it is
    // the Income-Tax portal's own AIS wire format, and the value that decrypts the
    // file they issue. Raising it to the 600k floor would simply fail to decrypt.
    // Nothing in this app SEALS anything with this KDF — `sharedcorelib/crypto` and
    // the Stronghold vault own every key we create, and they meet the floor.
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: 1000 }, // publisher-ci-ignore: kdf-floor
    pwKey,
    { name: "AES-CBC", length: 256 },
    false,
    ["decrypt"],
  );
}

/**
 * Split the encrypted AIS file into IV, salt and ciphertext. Exposed for tests.
 */
export function parseAisEnvelope(fileText: string): { iv: Uint8Array; salt: Uint8Array; ct: Uint8Array } {
  const text = fileText.replace(/\s+/g, "");
  if (text.length <= 64) throw new Error("AIS file is too short to be an encrypted envelope.");
  const iv = hexToBytes(text.slice(0, 32));
  const salt = hexToBytes(text.slice(32, 64));
  const rest = text.slice(64);
  // The ciphertext is base64 by default; some exports use hex. Detect hex only
  // when the remainder is *all* hex and even-length (base64 also matches [0-9a-f]).
  const ct = /^[0-9a-fA-F]+$/.test(rest) && rest.length % 2 === 0 ? hexToBytes(rest) : base64ToBytes(rest);
  return { iv, salt, ct };
}

/**
 * Decrypt and JSON-parse an AIS/TIS file. Throws with a friendly message when
 * none of the derived passwords work (usually a wrong PAN/DOB).
 */
export async function decryptAisFile(fileText: string, inputs: AisDecryptInputs): Promise<unknown> {
  const { iv, salt, ct } = parseAisEnvelope(fileText);
  const passwords = candidatePasswords(inputs);
  if (passwords.length === 0) throw new Error("Provide a PAN and date of birth (or a password).");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const pw of passwords) {
    try {
      const key = await deriveKey(pw, salt);
      const buf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, ct as BufferSource);
      const text = decoder.decode(buf);
      return JSON.parse(text);
    } catch {
      // Wrong key → bad padding / non-UTF-8 / non-JSON. Try the next candidate.
    }
  }
  throw new Error(
    "Couldn't decrypt this AIS file. Check the PAN and date of birth match the person the AIS was downloaded for, or enter the password manually.",
  );
}
