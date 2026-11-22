import { z } from "zod";

/**
 * Field building blocks shared by every profile type's `schema.ts`.
 *
 * Rules every profile field follows:
 * - optional (the claim flow stores `{}`; a blank form field means "not set"),
 * - trimmed and length-limited,
 * - no control characters, Unicode line/paragraph separators or bidi overrides
 *   (single-line fields also reject line breaks, so values are safe for vCard and email headers),
 * - URLs are https-only, emails are normalised (phones: see phone.ts / phone-input.ts).
 * Values are always rendered as plain text by React, never as HTML.
 */

/** C0/C1 controls (incl. CR/LF/TAB), U+2028/2029 and bidi embedding/override/isolate characters. */
const FORBIDDEN_SINGLE_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
/** Same as above, but LF is allowed (CRLF/CR are normalised to LF first). */
const FORBIDDEN_MULTI_LINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

const MAX_LINES = 20;

function blankToUndefined(value: unknown): unknown {
  if (value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

/** Required single-line text (used inside list items); see {@link singleLineText} for the optional form. */
export function requiredSingleLineText(max: number) {
  return z
    .string()
    .trim()
    .min(1, "This field is required.")
    .max(max, `Use at most ${max} characters.`)
    .refine((v) => !FORBIDDEN_SINGLE_LINE.test(v), "Remove line breaks and special characters.");
}

/** Optional single-line text, trimmed, at most `max` characters. */
export function singleLineText(max: number) {
  return z.preprocess(blankToUndefined, requiredSingleLineText(max).optional()).optional();
}

/** Optional multi-line text: CRLF normalised to LF, trimmed, at most `max` characters and 20 lines. */
export function multiLineText(max: number) {
  return z
    .preprocess(
      (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n") : v),
      z.preprocess(
        blankToUndefined,
        z
          .string()
          .trim()
          .max(max, `Use at most ${max} characters.`)
          .refine((v) => !FORBIDDEN_MULTI_LINE.test(v), "Remove special characters.")
          .refine((v) => v.split("\n").length <= MAX_LINES, `Use at most ${MAX_LINES} lines.`)
          .optional(),
      ),
    )
    .optional();
}

/** Makes a field optional; blank strings and null mean "not set". */
export function optionalField<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema.optional()).optional();
}

export const EMAIL_MAX = 254;

/** Lower-cased, trimmed email address. */
export const emailAddress = z
  .string()
  .trim()
  .max(EMAIL_MAX, "Enter a valid email address.")
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

export const URL_MAX = 500;

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Parses an https URL (scheme added if missing), rejecting other schemes, credentials and bare hosts. */
export function normaliseHttpsUrl(input: string): URL | null {
  const value = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!HOSTNAME.test(url.hostname)) return null;
  if (url.href.length > URL_MAX) return null;
  return url;
}

/** Required https URL, normalised to `URL.href`. */
export const httpsUrl = z
  .string()
  .trim()
  .max(URL_MAX, `Use at most ${URL_MAX} characters.`)
  .transform((v, ctx) => {
    const url = normaliseHttpsUrl(v);
    if (!url) {
      ctx.addIssue({ code: "custom", message: "Enter a full web address starting with https://" });
      return z.NEVER;
    }
    return url.href;
  });

export const optionalHttpsUrl = z.preprocess(blankToUndefined, httpsUrl.optional()).optional();

/**
 * Object-storage key of an uploaded image (uploads arrive in milestone 4). Only path segments of
 * [A-Za-z0-9_-] and an image extension, so it can't contain "..", "//", a scheme or a query.
 */
export const STORAGE_KEY_PATTERN = /^(?:[A-Za-z0-9_-]{1,64}\/){0,5}[A-Za-z0-9_-]{1,64}\.(?:jpe?g|png|webp)$/;

export const optionalStorageKey = z
  .preprocess(
    blankToUndefined,
    z.string().trim().max(200).regex(STORAGE_KEY_PATTERN, "Invalid image reference.").optional(),
  )
  .optional();

/**
 * An optional list: at most `max` items, each validated with `item`. On read, invalid items are
 * dropped one by one instead of discarding the whole list (see `parseProfileData`).
 */
export function list<T extends z.ZodType>(item: T, max: number) {
  const schema = z.array(item).max(max, `Add at most ${max}.`).optional();
  LIST_ITEMS.set(schema, { item, max });
  return schema;
}

const LIST_ITEMS = new WeakMap<z.ZodType, { item: z.ZodType; max: number }>();

// ---------- Detectors for private details in lost-item free text ----------

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** A run of digits possibly separated by spaces, dots, dashes or parentheses (how phone/ID numbers are written). */
const DIGIT_RUN = /\d(?:[\s().-]*\d)*/g;

/** Number of digits in the longest phone/ID-number-like run in `text`. */
export function longestDigitRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(DIGIT_RUN)) {
    const digits = match[0].replace(/\D/g, "").length;
    if (digits > longest) longest = digits;
  }
  return longest;
}

export function containsEmailAddress(text: string): boolean {
  return EMAIL_LIKE.test(text);
}

export const NO_CONTACT_DETAILS_MESSAGE =
  "For your privacy, don't include phone numbers or email addresses. Finders contact you through the message button.";

export const NO_NUMBERS_MESSAGE =
  "For your safety, don't include ID, card or account numbers, phone numbers or email addresses.";

/**
 * Refinement for lost-item text fields: rejects email addresses and digit runs of `maxDigits` or more
 * (phone numbers, card numbers, ID numbers). Owner contact goes through the relay, never the page.
 */
export function withoutContactDetails<T extends z.ZodType<string | undefined>>(
  schema: T,
  { maxDigits, message }: { maxDigits: number; message: string },
) {
  return schema.refine((v) => v === undefined || (!containsEmailAddress(v) && longestDigitRun(v) < maxDigits), message);
}

// ---------- Safe parsing ----------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read-side parser: never throws. Unknown keys are dropped; if the stored data doesn't fully match the
 * current schema (old or corrupted data), each field is kept only if it is valid on its own, and list
 * fields keep their valid items. Anything else falls back to "not set".
 */
export function parseProfileData<Shape extends z.ZodRawShape>(
  shape: Shape,
  raw: unknown,
): z.output<z.ZodObject<Shape>> {
  const schema = z.object(shape);
  const input = isPlainObject(raw) ? raw : {};
  const full = schema.safeParse(input);
  if (full.success) return full.data;

  const out: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(shape) as [string, z.ZodType][]) {
    const value = input[key];
    const listInfo = LIST_ITEMS.get(fieldSchema);
    if (listInfo && Array.isArray(value)) {
      const items = value.flatMap((item) => {
        const r = listInfo.item.safeParse(item);
        return r.success ? [r.data] : [];
      });
      if (items.length > 0) out[key] = items.slice(0, listInfo.max);
      continue;
    }
    const r = fieldSchema.safeParse(value);
    if (r.success && r.data !== undefined) out[key] = r.data;
  }
  // The salvaged object only contains values that passed their own field schema.
  const salvaged = schema.safeParse(out);
  return salvaged.success ? salvaged.data : (schema.parse({}) as z.output<z.ZodObject<Shape>>);
}

/** Write-side result with field errors keyed by dotted path (e.g. `phones.0.number`). */
export type ValidationResult<T> =
  { success: true; data: T } | { success: false; fieldErrors: Record<string, string>; formError?: string };

export function validateWith<T>(schema: z.ZodType<T>, raw: unknown): ValidationResult<T> {
  const r = schema.safeParse(raw);
  if (r.success) return { success: true, data: r.data };
  const fieldErrors: Record<string, string> = {};
  let formError: string | undefined;
  for (const issue of r.error.issues) {
    if (issue.code === "unrecognized_keys") {
      formError = "The form contained fields that aren't allowed.";
      continue;
    }
    const path = issue.path.join(".");
    if (!path) {
      formError ??= issue.message;
      continue;
    }
    fieldErrors[path] ??= issue.message;
  }
  return { success: false, fieldErrors, formError };
}

// ---------- FormData helpers (shared by editors' server actions and client-side validation) ----------

/** The string value of a form field, or undefined. Files and missing fields become undefined. */
export function formString(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Reads indexed rows like `phones.0.number`, `phones.0.label`, … into objects. Rows whose `required`
 * field is blank are skipped (an empty row in the editor means "no item"). Reads at most `max + 1` rows
 * so oversized submissions still fail validation instead of being silently cut.
 */
export function formRows<K extends string>(
  form: FormData,
  prefix: string,
  keys: readonly K[],
  required: K,
  max: number,
): Record<K, string | undefined>[] {
  const rows: Record<K, string | undefined>[] = [];
  for (let i = 0; i < 50 && rows.length <= max; i++) {
    const row = Object.fromEntries(keys.map((k) => [k, formString(form, `${prefix}.${i}.${k}`)])) as Record<
      K,
      string | undefined
    >;
    const anyPresent = keys.some((k) => row[k] !== undefined);
    if (!anyPresent) continue;
    if ((row[required] ?? "").trim() === "") continue;
    rows.push(row);
  }
  return rows;
}
