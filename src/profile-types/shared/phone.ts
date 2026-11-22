import "server-only";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { z } from "zod";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_INVALID_MESSAGE,
  PHONE_MAX_INPUT,
  PHONE_NEEDS_COUNTRY_MESSAGE,
  compactPhone,
  hasPhoneChars,
} from "./phone-input";

/**
 * Server-side phone validation with libphonenumber-js "max" metadata (per-country number plans).
 * `server-only` keeps that metadata out of client bundles; editors use `./phone-input.ts` instead.
 */

export type PhoneResult = { ok: true; e164: string } | { ok: false; reason: "needs_country" | "invalid" };

/** Validates a phone number for its country and returns it in E.164 ("+442079460958"). */
export function normalisePhoneNumber(
  input: string,
  defaultCountry: CountryCode | undefined = DEFAULT_PHONE_COUNTRY as CountryCode | undefined,
): PhoneResult {
  const trimmed = input.trim();
  if (trimmed.length > PHONE_MAX_INPUT || !hasPhoneChars(trimmed)) return { ok: false, reason: "invalid" };
  const compact = compactPhone(trimmed);
  if (!compact.startsWith("+") && !defaultCountry) return { ok: false, reason: "needs_country" };
  const parsed = parsePhoneNumberFromString(compact, defaultCountry);
  if (!parsed || !parsed.isValid()) return { ok: false, reason: "invalid" };
  return { ok: true, e164: parsed.number };
}

/** Phone number field: validated per country, stored as E.164. */
export const phoneNumber = z.string().transform((value, ctx) => {
  const result = normalisePhoneNumber(value);
  if (!result.ok) {
    ctx.addIssue({
      code: "custom",
      message: result.reason === "needs_country" ? PHONE_NEEDS_COUNTRY_MESSAGE : PHONE_INVALID_MESSAGE,
    });
    return z.NEVER;
  }
  return result.e164;
});

/** International display format ("+44 20 7946 0958"); falls back to the stored value. */
export function formatPhoneInternational(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed?.isValid() ? parsed.formatInternational() : e164;
}
