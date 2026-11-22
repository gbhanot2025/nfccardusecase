import { z } from "zod";

/**
 * Phone handling that is safe for the client bundle (no libphonenumber metadata). Editors use it for
 * quick feedback; the server schemas (`./phone.ts`) do the real per-country validation.
 */

export const PHONE_MAX_INPUT = 32;

/**
 * Where a default country would go once the market is decided. With no default, a number must be
 * entered in international format (leading "+"); national numbers are rejected with
 * {@link PHONE_NEEDS_COUNTRY_MESSAGE}. If a default is set, server validation uses it for numbers
 * without "+" (see `normalisePhoneNumber` in `./phone.ts`); also relax `lightPhoneNumber` then.
 */
export const DEFAULT_PHONE_COUNTRY: string | undefined = undefined;

export const PHONE_NEEDS_COUNTRY_MESSAGE =
  "Start with + and your country code, for example +44 20 7946 0958 or +1 415 555 2671.";
export const PHONE_INVALID_MESSAGE = "This doesn't look like a valid phone number. Check the country code and digits.";

/** Characters people type in phone numbers. Anything else (letters, "ext", line breaks) is rejected. */
const PHONE_CHARS = /^[+0-9 ().\-/ ]*$/;

/** Strips separators; "00" international prefix becomes "+". */
export function compactPhone(input: string): string {
  return input.replace(/[ ().\-/ ]/g, "").replace(/^00/, "+");
}

export function hasPhoneChars(input: string): boolean {
  return PHONE_CHARS.test(input);
}

/** Light client-side check: "+", then 7–15 digits (E.164 shape). */
export const lightPhoneNumber = z
  .string()
  .trim()
  .max(PHONE_MAX_INPUT, PHONE_INVALID_MESSAGE)
  .refine(hasPhoneChars, PHONE_INVALID_MESSAGE)
  .transform(compactPhone)
  .refine((v) => v.startsWith("+") || DEFAULT_PHONE_COUNTRY !== undefined, PHONE_NEEDS_COUNTRY_MESSAGE)
  .refine((v) => /^\+?[1-9][0-9]{6,14}$/.test(v), PHONE_INVALID_MESSAGE);
