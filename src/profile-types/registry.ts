/**
 * The one place profile types are registered. Milestone 3 adds each type's folder
 * (`schema.ts`, `Editor.tsx`, `PublicPage.tsx`) and hooks them in here.
 */
export const PROFILE_TYPES = ["business_card", "lost_pet", "lost_device", "lost_id"] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export const PROFILE_TYPE_INFO: Record<ProfileType, { label: string; description: string; lostItem: boolean }> = {
  business_card: {
    label: "Digital business card",
    description: "Share your contact details; visitors can save you to their phone.",
    lostItem: false,
  },
  lost_pet: {
    label: "Lost pet",
    description: "Whoever finds your pet can see its details and message you privately.",
    lostItem: true,
  },
  lost_device: {
    label: "Lost device",
    description: "Ask whoever finds your device to return it, without showing your details.",
    lostItem: true,
  },
  lost_id: {
    label: "Lost wallet / ID",
    description: "Let a finder contact you about your wallet without exposing who you are.",
    lostItem: true,
  },
};

export const FORM_FACTORS = ["card", "collar", "sticker", "keychain", "wristband"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

export const FORM_FACTOR_LABEL: Record<FormFactor, string> = {
  card: "Card",
  collar: "Collar tag",
  sticker: "Sticker",
  keychain: "Keychain",
  wristband: "Wristband",
};

// ---------------------------------------------------------------------------
// Milestone 3: data schemas per type.
//
// Only schemas and pure helpers are registered here, so this file stays safe to import from Client
// Components (e.g. a type picker). The React components (PublicPage, Editor) are registered in
// `./modules.ts`, which is server-only.
// ---------------------------------------------------------------------------

import type { z } from "zod";
import {
  businessCardFromFormData,
  businessCardSchema,
  isBusinessCardEmpty,
  parseBusinessCardData,
  validateBusinessCardData,
  type BusinessCardData,
} from "./business_card/schema";
import {
  isLostDeviceEmpty,
  lostDeviceFromFormData,
  lostDeviceSchema,
  parseLostDeviceData,
  validateLostDeviceData,
  type LostDeviceData,
} from "./lost_device/schema";
import {
  isLostIdEmpty,
  lostIdFromFormData,
  lostIdSchema,
  parseLostIdData,
  validateLostIdData,
  type LostIdData,
} from "./lost_id/schema";
import {
  isLostPetEmpty,
  lostPetFromFormData,
  lostPetSchema,
  parseLostPetData,
  validateLostPetData,
  type LostPetData,
} from "./lost_pet/schema";
import type { ValidationResult } from "./shared/fields";

/** Parsed `profiles.data` for each type. */
export interface ProfileDataMap {
  business_card: BusinessCardData;
  lost_pet: LostPetData;
  lost_device: LostDeviceData;
  lost_id: LostIdData;
}

export interface ProfileTypeSchema<T> {
  /** Write schema (strict: unknown keys are rejected). `{}` is valid. */
  schema: z.ZodType<T>;
  /** Read helper: never throws; unknown or invalid stored data falls back to "not set". */
  parse: (raw: unknown) => T;
  /** Write helper: Zod result with field errors keyed by dotted path. */
  validate: (raw: unknown) => ValidationResult<T>;
  /** Maps the type's editor form to the raw object `validate` expects (only known fields). */
  fromFormData: (form: FormData) => Record<string, unknown>;
  /** True while the owner hasn't filled anything in (the claim flow stores `{}`). */
  isEmpty: (data: T) => boolean;
}

export const PROFILE_TYPE_SCHEMAS: { [K in ProfileType]: ProfileTypeSchema<ProfileDataMap[K]> } = {
  business_card: {
    schema: businessCardSchema,
    parse: parseBusinessCardData,
    validate: validateBusinessCardData,
    fromFormData: businessCardFromFormData,
    isEmpty: isBusinessCardEmpty,
  },
  lost_pet: {
    schema: lostPetSchema,
    parse: parseLostPetData,
    validate: validateLostPetData,
    fromFormData: lostPetFromFormData,
    isEmpty: isLostPetEmpty,
  },
  lost_device: {
    schema: lostDeviceSchema,
    parse: parseLostDeviceData,
    validate: validateLostDeviceData,
    fromFormData: lostDeviceFromFormData,
    isEmpty: isLostDeviceEmpty,
  },
  lost_id: {
    schema: lostIdSchema,
    parse: parseLostIdData,
    validate: validateLostIdData,
    fromFormData: lostIdFromFormData,
    isEmpty: isLostIdEmpty,
  },
};

export function isProfileType(value: unknown): value is ProfileType {
  return typeof value === "string" && (PROFILE_TYPES as readonly string[]).includes(value);
}

/** Read `profiles.data` for any type; never throws. */
export function parseProfileDataFor<K extends ProfileType>(type: K, raw: unknown): ProfileDataMap[K] {
  return PROFILE_TYPE_SCHEMAS[type].parse(raw);
}

/** Validate input for `profiles.data` of any type before writing it. */
export function validateProfileDataFor<K extends ProfileType>(
  type: K,
  raw: unknown,
): ValidationResult<ProfileDataMap[K]> {
  return PROFILE_TYPE_SCHEMAS[type].validate(raw);
}
