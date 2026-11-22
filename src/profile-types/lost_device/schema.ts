import { z } from "zod";
import { formString, optionalStorageKey, parseProfileData, validateWith } from "../shared/fields";
import { RETURN_MESSAGE_MAX, REWARD_MAX, lostMultiLineText, lostText } from "../shared/lost";

export const LOST_DEVICE_LIMITS = {
  nickname: 60,
  returnMessage: RETURN_MESSAGE_MAX,
  reward: REWARD_MAX,
} as const;

/** No owner name/email/phone/address fields by design: the finder contacts the owner through the relay. */
const shape = {
  nickname: lostText(LOST_DEVICE_LIMITS.nickname),
  returnMessage: lostMultiLineText(LOST_DEVICE_LIMITS.returnMessage),
  reward: lostText(LOST_DEVICE_LIMITS.reward),
  photoKey: optionalStorageKey,
};

/** Write schema: unknown keys are rejected. `{}` is valid ("not set up yet"). */
export const lostDeviceSchema = z.strictObject(shape);
export type LostDeviceData = z.output<typeof lostDeviceSchema>;

/** Safe on read: never throws; unknown keys are dropped and invalid fields fall back to "not set". */
export function parseLostDeviceData(raw: unknown): LostDeviceData {
  return parseProfileData(shape, raw);
}

export function validateLostDeviceData(raw: unknown) {
  return validateWith(lostDeviceSchema, raw);
}

export function isLostDeviceEmpty(data: LostDeviceData): boolean {
  return !data.nickname && !data.returnMessage && !data.photoKey;
}

export function lostDeviceFromFormData(form: FormData): Record<string, unknown> {
  return {
    nickname: formString(form, "nickname"),
    returnMessage: formString(form, "returnMessage"),
    reward: formString(form, "reward"),
    photoKey: formString(form, "photoKey"),
  };
}
