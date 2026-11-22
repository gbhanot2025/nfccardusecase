import { describe, expect, it } from "vitest";
import { formatPhoneInternational, normalisePhoneNumber, phoneNumber } from "@/profile-types/shared/phone";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_INVALID_MESSAGE,
  PHONE_NEEDS_COUNTRY_MESSAGE,
  lightPhoneNumber,
} from "@/profile-types/shared/phone-input";

describe("phone numbers (server, libphonenumber-js max metadata)", () => {
  it.each([
    ["+44 20 7946 0958", "+442079460958", "+44 20 7946 0958"], // UK landline
    ["+44 7400 123456", "+447400123456", "+44 7400 123456"], // UK mobile
    ["+1 (415) 555-2671", "+14155552671", "+1 415 555 2671"], // US
    ["+49 30 901820", "+4930901820", "+49 30 901820"], // Germany
    ["+33 1 23 45 67 89", "+33123456789", "+33 1 23 45 67 89"], // France
    ["+61 2 9374 4000", "+61293744000", "+61 2 9374 4000"], // Australia
    ["+91 98765 43210", "+919876543210", "+91 98765 43210"], // India
    ["0044 20 7946 0958", "+442079460958", "+44 20 7946 0958"], // 00 international prefix
    ["+44.20.7946.0958", "+442079460958", "+44 20 7946 0958"],
  ])("accepts %j, stores E.164 and formats it internationally", (input, e164, display) => {
    expect(phoneNumber.parse(input)).toBe(e164);
    expect(formatPhoneInternational(e164)).toBe(display);
  });

  it.each(["020 7946 0958", "(415) 555-2671", "07400 123456", "4930901820"])(
    "rejects national number %j and asks for the country code",
    (input) => {
      const r = phoneNumber.safeParse(input);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toBe(PHONE_NEEDS_COUNTRY_MESSAGE);
    },
  );

  it.each([
    "+1 555 123 4567", // not a real US number plan
    "+44 20 1234", // too short for the UK
    "+44 20 7946 0958 123", // too long for the UK
    "+999 1234567", // no such country code
    "+44 20 7946 0958 ext 2",
    "+1 415 CALL NOW",
    "+1 415\n555 2671",
    "+".padEnd(40, "1"),
    "",
  ])("rejects invalid number %j", (input) => {
    const r = phoneNumber.safeParse(input);
    expect(r.success).toBe(false);
    if (input.startsWith("+")) expect(r.error?.issues[0].message).toBe(PHONE_INVALID_MESSAGE);
  });

  it("has no default country yet, but one can be passed in", () => {
    expect(DEFAULT_PHONE_COUNTRY).toBeUndefined();
    expect(normalisePhoneNumber("020 7946 0958")).toEqual({ ok: false, reason: "needs_country" });
    expect(normalisePhoneNumber("020 7946 0958", "GB")).toEqual({ ok: true, e164: "+442079460958" });
    expect(normalisePhoneNumber("(415) 555-2671", "US")).toEqual({ ok: true, e164: "+14155552671" });
  });

  it("formatting falls back to the stored value for unknown input", () => {
    expect(formatPhoneInternational("not a number")).toBe("not a number");
  });
});

describe("light phone check (client editor)", () => {
  it("accepts + and 7–15 digits and normalises separators", () => {
    expect(lightPhoneNumber.parse("+44 20 7946 0958")).toBe("+442079460958");
    expect(lightPhoneNumber.parse("0044 20 7946 0958")).toBe("+442079460958");
  });

  it("asks for the country code for national numbers", () => {
    const r = lightPhoneNumber.safeParse("020 7946 0958");
    expect(r.error?.issues[0].message).toBe(PHONE_NEEDS_COUNTRY_MESSAGE);
  });

  it.each(["+12345", "+1234567890123456", "+0 20 7946 0958", "+44 abc", "+44\n2079460958"])("rejects %j", (input) => {
    expect(lightPhoneNumber.safeParse(input).success).toBe(false);
  });
});
