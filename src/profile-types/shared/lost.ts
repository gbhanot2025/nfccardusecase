import {
  NO_CONTACT_DETAILS_MESSAGE,
  NO_NUMBERS_MESSAGE,
  multiLineText,
  singleLineText,
  withoutContactDetails,
} from "./fields";

/**
 * Text fields for lost-item profiles. These types deliberately have NO owner name, email, phone or
 * address fields: finders reach the owner through the relay (milestone 4). Free text also rejects
 * email addresses and phone-number-like digit runs so contact details can't be smuggled in.
 */
export function lostText(max: number) {
  return withoutContactDetails(singleLineText(max), { maxDigits: 7, message: NO_CONTACT_DETAILS_MESSAGE });
}

export function lostMultiLineText(max: number) {
  return withoutContactDetails(multiLineText(max), { maxDigits: 7, message: NO_CONTACT_DETAILS_MESSAGE });
}

/** Stricter variant for `lost_id`: no run of 5+ digits at all (ID, card, account or phone numbers). */
export function lostIdText(max: number) {
  return withoutContactDetails(singleLineText(max), { maxDigits: 5, message: NO_NUMBERS_MESSAGE });
}

export function lostIdMultiLineText(max: number) {
  return withoutContactDetails(multiLineText(max), { maxDigits: 5, message: NO_NUMBERS_MESSAGE });
}

export const REWARD_MAX = 80;
export const RETURN_MESSAGE_MAX = 500;
