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
import {
  PROFILE_TYPE_INFO,
  PROFILE_TYPE_SCHEMAS,
  type ProfileDataMap,
  type ProfileType,
  type ProfileTypeSchema,
} from "./registry";
import type { EditorAction, EditorProps, PublicPageProps } from "./shared/types";

/**
 * Profile type → schema helpers + React components, for route code (`/t/{id}`, `/q/{code}`, the
 * dashboard editor). Lives apart from `registry.ts` on purpose: registry.ts is imported from Client
 * Components too (type pickers), and pulling every PublicPage/Editor and their CSS into those bundles
 * would be wasteful; `server-only` makes that mistake a build error here.
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
