import "server-only";
import { z } from "zod";
import { parseProfileData, validateWith } from "../shared/fields";
import { phoneNumber } from "../shared/phone";
import { businessCardShape } from "./shape";

export * from "./shape";

/**
 * Server authority for business card data: phones are validated per country (libphonenumber-js max
 * metadata) and stored as E.164. Client code imports `./shape.ts` instead.
 */
const shape = businessCardShape(phoneNumber);

/** Write schema: unknown keys are rejected. `{}` is valid ("not set up yet"). */
export const businessCardSchema = z.strictObject(shape);
export type BusinessCardData = z.output<typeof businessCardSchema>;

/** Safe on read: never throws; invalid or unknown data falls back to "not set". */
export function parseBusinessCardData(raw: unknown): BusinessCardData {
  return parseProfileData(shape, raw);
}

export function validateBusinessCardData(raw: unknown) {
  return validateWith(businessCardSchema, raw);
}

export function isBusinessCardEmpty(data: BusinessCardData): boolean {
  return !data.name && !data.company && !data.phones?.length && !data.emails?.length && !data.website;
}
