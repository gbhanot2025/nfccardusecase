import "server-only";
import { randomInt } from "node:crypto";

/**
 * Random codes for tags. All use a cryptographically secure generator and an alphabet without
 * look-alike characters (no I, L, O, U), so printed codes are easy to read and type.
 */
const UPPER = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: 5 bits per character
const LOWER = UPPER.toLowerCase();

function randomString(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Tag ID in the NFC URL (/t/{id}): 16 chars = 80 bits, lowercase so it survives any URL handling. */
export const TAG_ID_LENGTH = 16;
export const TAG_ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{16}$/;
export function newTagId(): string {
  return randomString(LOWER, TAG_ID_LENGTH);
}

/** Public code for the QR link (/q/{code}): 10 chars = 50 bits. Read-only, so it can be shorter. */
export const PUBLIC_CODE_LENGTH = 10;
export const PUBLIC_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;
export function newPublicCode(): string {
  return randomString(UPPER, PUBLIC_CODE_LENGTH);
}

/** Batch ID shown to admins. */
export function newBatchId(): string {
  return `b_${randomString(LOWER, 12)}`;
}

/** Claim code printed on the packaging insert: 10 chars = 50 bits, shown as XXXXX-XXXXX. */
export const CLAIM_CODE_LENGTH = 10;
export function newClaimCode(): string {
  return randomString(UPPER, CLAIM_CODE_LENGTH);
}

export function formatClaimCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * Turn what a person typed into the canonical claim code, forgiving spaces, dashes, lowercase and
 * the usual look-alikes (O→0, I/L→1). Returns null if it can't be a claim code.
 */
export function normalizeClaimCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (cleaned.length !== CLAIM_CODE_LENGTH) return null;
  for (const ch of cleaned) if (!UPPER.includes(ch)) return null;
  return cleaned;
}

/** Public codes are typed rarely, but accept lowercase from hand-typed short links. */
export function normalizePublicCode(input: string): string | null {
  const upper = input.toUpperCase();
  return PUBLIC_CODE_PATTERN.test(upper) ? upper : null;
}
