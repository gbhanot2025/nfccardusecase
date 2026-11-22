import { z } from "zod";
import {
  emailAddress,
  formRows,
  formString,
  httpsUrl,
  list,
  multiLineText,
  optionalHttpsUrl,
  optionalStorageKey,
  singleLineText,
  validateWith,
} from "../shared/fields";
import { lightPhoneNumber } from "../shared/phone-input";

/**
 * Business card fields, limits and form mapping. Client-safe: the shape takes the phone field as a
 * parameter, so the editor validates with a light phone check while `./schema.ts` (server) plugs in
 * per-country validation.
 */

export const BUSINESS_CARD_LIMITS = {
  name: 100,
  title: 100,
  company: 100,
  bio: 500,
  phones: 3,
  emails: 3,
  socials: 8,
} as const;

export const PHONE_LABELS = ["mobile", "work", "home", "other"] as const;
export const EMAIL_LABELS = ["work", "home", "other"] as const;

export const PHONE_LABEL_TEXT: Record<(typeof PHONE_LABELS)[number], string> = {
  mobile: "Mobile",
  work: "Work",
  home: "Home",
  other: "Other",
};
export const EMAIL_LABEL_TEXT: Record<(typeof EMAIL_LABELS)[number], string> = {
  work: "Work",
  home: "Personal",
  other: "Other",
};

/**
 * Allowlisted social networks and the hosts their profile URLs may point to (the host itself or a
 * subdomain of it). A link that claims to be LinkedIn but points elsewhere is rejected.
 */
export const SOCIAL_NETWORKS = {
  linkedin: { label: "LinkedIn", hosts: ["linkedin.com"] },
  x: { label: "X (Twitter)", hosts: ["x.com", "twitter.com"] },
  instagram: { label: "Instagram", hosts: ["instagram.com"] },
  facebook: { label: "Facebook", hosts: ["facebook.com", "fb.com"] },
  github: { label: "GitHub", hosts: ["github.com"] },
  youtube: { label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  tiktok: { label: "TikTok", hosts: ["tiktok.com"] },
  threads: { label: "Threads", hosts: ["threads.net", "threads.com"] },
  bluesky: { label: "Bluesky", hosts: ["bsky.app"] },
} as const satisfies Record<string, { label: string; hosts: readonly string[] }>;

export type SocialNetwork = keyof typeof SOCIAL_NETWORKS;
export const SOCIAL_NETWORK_IDS = Object.keys(SOCIAL_NETWORKS) as SocialNetwork[];

export function isUrlForNetwork(network: SocialNetwork, href: string): boolean {
  let host: string;
  try {
    host = new URL(href).hostname;
  } catch {
    return false;
  }
  return SOCIAL_NETWORKS[network].hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

const emailItem = z.strictObject({
  label: z.enum(EMAIL_LABELS).default("work"),
  address: emailAddress,
});

const socialItem = z
  .strictObject({
    network: z.enum(SOCIAL_NETWORK_IDS as [SocialNetwork, ...SocialNetwork[]]),
    url: httpsUrl,
  })
  .refine((v) => isUrlForNetwork(v.network, v.url), {
    message: "This link doesn't point to the selected network.",
    path: ["url"],
  });

/** Builds the field shape with the given phone validator (server: per-country; client: light). */
export function businessCardShape<P extends z.ZodType<string>>(phone: P) {
  const phoneItem = z.strictObject({
    label: z.enum(PHONE_LABELS).default("mobile"),
    number: phone,
  });
  return {
    name: singleLineText(BUSINESS_CARD_LIMITS.name),
    title: singleLineText(BUSINESS_CARD_LIMITS.title),
    company: singleLineText(BUSINESS_CARD_LIMITS.company),
    bio: multiLineText(BUSINESS_CARD_LIMITS.bio),
    phones: list(phoneItem, BUSINESS_CARD_LIMITS.phones),
    emails: list(emailItem, BUSINESS_CARD_LIMITS.emails),
    website: optionalHttpsUrl,
    /** The company's own page (separate from the person's website). */
    companyUrl: optionalHttpsUrl,
    socials: list(socialItem, BUSINESS_CARD_LIMITS.socials),
    photoKey: optionalStorageKey,
    logoKey: optionalStorageKey,
  };
}

/** Light schema for client-side checks in the editor; the server schema is the authority. */
export const businessCardFormSchema = z.strictObject(businessCardShape(lightPhoneNumber));

export function validateBusinessCardForm(raw: unknown) {
  return validateWith(businessCardFormSchema, raw);
}

/**
 * Maps the editor's form fields to the raw object the schema validates. Keeps only known keys.
 * Image keys are never read from the form (a client could point them at someone else's upload):
 * the upload action (milestone 4) sets them, and the save action keeps the stored value.
 */
export function businessCardFromFormData(form: FormData): Record<string, unknown> {
  return {
    name: formString(form, "name"),
    title: formString(form, "title"),
    company: formString(form, "company"),
    bio: formString(form, "bio"),
    phones: formRows(form, "phones", ["label", "number"], "number", BUSINESS_CARD_LIMITS.phones),
    emails: formRows(form, "emails", ["label", "address"], "address", BUSINESS_CARD_LIMITS.emails),
    website: formString(form, "website"),
    companyUrl: formString(form, "companyUrl"),
    socials: formRows(form, "socials", ["network", "url"], "url", BUSINESS_CARD_LIMITS.socials),
  };
}
