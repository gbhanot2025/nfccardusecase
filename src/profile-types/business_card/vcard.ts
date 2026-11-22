import { SOCIAL_NETWORKS, type BusinessCardData } from "./schema";

/**
 * vCard 3.0 (RFC 2426) builder for the "Save contact" button.
 *
 * - Lines end with CRLF and are folded at 75 octets (UTF-8 aware: a multi-byte character is never split).
 * - Text values escape `\`, `,`, `;` and line breaks; every other control character is removed, so a
 *   value can never start a new property (no "newline injection").
 * - Property names and parameters come only from constants/enums, never from user data.
 * - The photo is embedded as base64 when the caller passes its bytes (fetching from storage is the
 *   route's job).
 *
 * Serve with {@link VCARD_CONTENT_TYPE} and `Content-Disposition: attachment; filename="…"` from
 * {@link vcardFilename}.
 */

export const VCARD_CONTENT_TYPE = "text/vcard; charset=utf-8";

/** Photos larger than this are left out so the vCard stays small enough for phones to import. */
export const VCARD_MAX_PHOTO_BYTES = 1024 * 1024;

const PHOTO_TYPES = { "image/jpeg": "JPEG", "image/png": "PNG", "image/gif": "GIF" } as const;
export type VCardPhotoMimeType = keyof typeof PHOTO_TYPES;

export interface VCardPhoto {
  bytes: Uint8Array;
  mimeType: string;
}

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;

/** Removes control characters other than line breaks, plus Unicode separators and bidi controls. */
function stripControls(value: string): string {
  return value.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "");
}

/** Escapes a TEXT value (RFC 2426 §4: backslash, comma, semicolon, newline). */
export function escapeText(value: string): string {
  return stripControls(value)
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r\n|\r|\n|\u2028|\u2029/g, "\\n");
}

/**
 * URI values aren't TEXT, so backslash escapes don't apply; percent-encode the characters that could
 * be misread as separators and drop anything that could break the line.
 */
function escapeUri(value: string): string {
  return stripControls(value)
    .replace(/[\r\n\u2028\u2029\s]/g, "")
    .replace(/[,;\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets; continuation lines start with one space (which counts toward the 75). */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const octets = encoder.encode(char).length;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += char;
    currentOctets += octets;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

function splitName(fullName: string): { family: string; given: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return { family: "", given: parts[0] ?? "" };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

const PHONE_TYPE: Record<string, string> = {
  mobile: "CELL,VOICE",
  work: "WORK,VOICE",
  home: "HOME,VOICE",
  other: "VOICE",
};

const EMAIL_TYPE: Record<string, string> = {
  work: "INTERNET,WORK",
  home: "INTERNET,HOME",
  other: "INTERNET",
};

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export interface BuildVCardOptions {
  /** Photo bytes and MIME type; embedded if JPEG/PNG/GIF and at most {@link VCARD_MAX_PHOTO_BYTES}. */
  photo?: VCardPhoto;
  /** Revision timestamp (defaults to now). */
  revision?: Date;
}

/** Builds a vCard 3.0 string from parsed business card data. */
export function buildVCard(data: BusinessCardData, options: BuildVCardOptions = {}): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  const text = (name: string, value: string | undefined) => {
    if (value) lines.push(`${name}:${escapeText(value)}`);
  };

  const fullName = data.name?.trim() || data.company?.trim() || "Contact";
  const { family, given } = data.name ? splitName(data.name) : { family: "", given: "" };
  lines.push(`N:${escapeText(family)};${escapeText(given)};;;`);
  lines.push(`FN:${escapeText(fullName)}`);
  text("ORG", data.company);
  text("TITLE", data.title);

  for (const phone of data.phones ?? []) {
    lines.push(`TEL;TYPE=${PHONE_TYPE[phone.label] ?? "VOICE"}:${escapeUri(phone.number)}`);
  }
  for (const email of data.emails ?? []) {
    lines.push(`EMAIL;TYPE=${EMAIL_TYPE[email.label] ?? "INTERNET"}:${escapeText(email.address)}`);
  }
  if (data.website) lines.push(`URL:${escapeUri(data.website)}`);

  // Labelled URLs use Apple's item grouping; other clients still import them as plain URLs.
  let item = 0;
  const labelledUrl = (url: string, label: string) => {
    item += 1;
    lines.push(`item${item}.URL:${escapeUri(url)}`);
    lines.push(`item${item}.X-ABLabel:${escapeText(label)}`);
  };
  if (data.companyUrl) labelledUrl(data.companyUrl, "Company");
  for (const social of data.socials ?? []) {
    const network = SOCIAL_NETWORKS[social.network];
    if (network) labelledUrl(social.url, network.label);
  }

  text("NOTE", data.bio);

  const photo = options.photo;
  if (photo && photo.mimeType in PHOTO_TYPES && photo.bytes.byteLength <= VCARD_MAX_PHOTO_BYTES) {
    const type = PHOTO_TYPES[photo.mimeType as VCardPhotoMimeType];
    lines.push(`PHOTO;ENCODING=b;TYPE=${type}:${base64(photo.bytes)}`);
  }

  const rev = (options.revision ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  lines.push(`REV:${rev}`);
  lines.push("END:VCARD");

  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** ASCII-only, header-safe file name such as `jane-doe.vcf`. */
export function vcardFilename(data: BusinessCardData): string {
  const base = (data.name || data.company || "contact")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "contact"}.vcf`;
}
