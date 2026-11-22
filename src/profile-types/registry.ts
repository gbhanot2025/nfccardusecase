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
