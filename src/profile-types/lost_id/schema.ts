import { z } from "zod";
import { formString, parseProfileData, validateWith } from "../shared/fields";
import { RETURN_MESSAGE_MAX, REWARD_MAX, lostIdMultiLineText, lostIdText } from "../shared/lost";

export const LOST_ID_LIMITS = {
  returnMessage: RETURN_MESSAGE_MAX,
  reward: REWARD_MAX,
} as const;

/**
 * Security rule: `lost_id` never stores ID numbers, card numbers or addresses, and (like every lost
 * type) no owner name/email/phone. So the schema has only a return message and a reward, and both
 * reject digit runs of 5+ (ID/card/account/phone numbers, postcodes) and email addresses.
 * There is deliberately no photo: a photo of a wallet or ID could show the very numbers we refuse.
 */
const shape = {
  returnMessage: lostIdMultiLineText(LOST_ID_LIMITS.returnMessage),
  reward: lostIdText(LOST_ID_LIMITS.reward),
};

/** Write schema: any other key (e.g. `idNumber`, `cardNumber`, `address`) is rejected. */
export const lostIdSchema = z.strictObject(shape);
export type LostIdData = z.output<typeof lostIdSchema>;

/** Safe on read: never throws; unknown keys (including any legacy forbidden ones) are dropped. */
export function parseLostIdData(raw: unknown): LostIdData {
  return parseProfileData(shape, raw);
}

export function validateLostIdData(raw: unknown) {
  return validateWith(lostIdSchema, raw);
}

export function isLostIdEmpty(data: LostIdData): boolean {
  return !data.returnMessage;
}

export function lostIdFromFormData(form: FormData): Record<string, unknown> {
  return {
    returnMessage: formString(form, "returnMessage"),
    reward: formString(form, "reward"),
  };
}
