/**
 * Server-side registration of the profile types listed in `./registry.ts`: their data schemas
 * (`PROFILE_TYPE_SCHEMAS`) and components (`PROFILE_TYPE_MODULES`).
 *
 * Why not in registry.ts: registry.ts is also imported from Client Components (type pickers in the
 * claim flow/dashboard). The server schemas pull in libphonenumber-js "max" metadata and this map pulls
 * in every PublicPage/Editor and their CSS; none of that may end up in client bundles. `server-only`
 * turns such an import into a build error. Editors validate on the client with each type's light
 * `shape.ts` schema instead.
 */
import "server-only";
import { createElement, type ComponentType, type ReactNode } from "react";
import { BusinessCardEditor } from "./business_card/Editor";
import { BusinessCardPublicPage } from "./business_card/PublicPage";
import { LostDeviceEditor } from "./lost_device/Editor";
import { LostDevicePublicPage } from "./lost_device/PublicPage";
import { LostIdEditor } from "./lost_id/Editor";
import { LostIdPublicPage } from "./lost_id/PublicPage";
import { LostPetEditor } from "./lost_pet/Editor";
import { LostPetPublicPage } from "./lost_pet/PublicPage";
import { PROFILE_TYPES, PROFILE_TYPE_INFO, type ProfileType } from "./registry";
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
import type { EditorAction, EditorProps, PublicPageProps } from "./shared/types";

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

/**
 * Profile type → schema helpers + React components, for route code (`/t/{id}`, `/q/{code}`, the
 * dashboard editor).
 */
export interface ProfileTypeModule<K extends ProfileType> extends ProfileTypeSchema<ProfileDataMap[K]> {
  type: K;
  info: (typeof PROFILE_TYPE_INFO)[K];
  PublicPage: (props: PublicPageProps<ProfileDataMap[K]>) => ReactNode;
  Editor: ComponentType<EditorProps<ProfileDataMap[K]>>;
}

function moduleFor<K extends ProfileType>(
  type: K,
  PublicPage: ProfileTypeModule<K>["PublicPage"],
  Editor: ProfileTypeModule<K>["Editor"],
): ProfileTypeModule<K> {
  return { type, info: PROFILE_TYPE_INFO[type], ...PROFILE_TYPE_SCHEMAS[type], PublicPage, Editor };
}

export const PROFILE_TYPE_MODULES: { [K in ProfileType]: ProfileTypeModule<K> } = {
  business_card: moduleFor("business_card", BusinessCardPublicPage, BusinessCardEditor),
  lost_pet: moduleFor("lost_pet", LostPetPublicPage, LostPetEditor),
  lost_device: moduleFor("lost_device", LostDevicePublicPage, LostDeviceEditor),
  lost_id: moduleFor("lost_id", LostIdPublicPage, LostIdEditor),
};

/**
 * Renders the public page for a stored profile: parses `data` safely, then picks the type's page.
 * Usage in a route: `<ProfilePublicPage type={profile.type} data={profile.data} lostMode={profile.lostMode} … />`
 */
export function ProfilePublicPage<K extends ProfileType>({
  type,
  data,
  ...rest
}: Omit<PublicPageProps<unknown>, "data"> & { type: K; data: unknown }): ReactNode {
  const mod: ProfileTypeModule<K> = PROFILE_TYPE_MODULES[type];
  return createElement(mod.PublicPage, { ...rest, data: mod.parse(data) });
}

/**
 * Renders the editor for a stored profile with safely parsed initial values.
 * Usage: `<ProfileEditor type={profile.type} data={profile.data} action={saveProfile.bind(null, profile.id)} />`
 */
export function ProfileEditor<K extends ProfileType>({
  type,
  data,
  action,
}: {
  type: K;
  data: unknown;
  action: EditorAction;
}): ReactNode {
  const mod: ProfileTypeModule<K> = PROFILE_TYPE_MODULES[type];
  return createElement(mod.Editor, { action, initialData: mod.parse(data) });
}
