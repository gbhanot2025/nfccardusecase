import { describe, expect, it } from "vitest";
import {
  lostDeviceFromFormData,
  lostDeviceSchema,
  parseLostDeviceData,
  validateLostDeviceData,
} from "@/profile-types/lost_device/schema";
import { lostIdFromFormData, lostIdSchema, parseLostIdData, validateLostIdData } from "@/profile-types/lost_id/schema";
import { lostPetFromFormData, lostPetSchema, parseLostPetData } from "@/profile-types/lost_pet/schema";

/** Owner contact/identity keys that must never exist on any lost_* type (contact goes through the relay). */
const OWNER_KEYS = [
  "name",
  "ownerName",
  "email",
  "ownerEmail",
  "phone",
  "ownerPhone",
  "phones",
  "emails",
  "address",
  "ownerAddress",
];

/** What `{}` parses to. */
const lostSchemas = [
  ["lost_pet", lostPetSchema, parseLostPetData, {}],
  ["lost_device", lostDeviceSchema, parseLostDeviceData, {}],
  ["lost_id", lostIdSchema, parseLostIdData, {}],
] as const;

describe.each(lostSchemas)("%s schema (shared lost rules)", (_type, schema, parse, empty) => {
  it("accepts {}", () => {
    expect(schema.parse({})).toEqual(empty);
    expect(parse({})).toEqual(empty);
  });

  it("has no owner name/email/phone/address fields", () => {
    for (const key of OWNER_KEYS) {
      expect(Object.keys(schema.shape)).not.toContain(key);
      expect(schema.safeParse({ [key]: "x" }).success, key).toBe(false);
      expect(parse({ [key]: "x" }), key).toEqual(empty);
    }
  });

  it.each([
    "Call me on +44 20 7946 0958",
    "ring 555-123-4567 please",
    "email jane@example.com",
    "Reward! contact owner@example.org",
  ])("rejects contact details in the reward text: %j", (text) => {
    expect(schema.safeParse({ reward: text }).success).toBe(false);
  });

  it("allows a plain reward", () => {
    expect(schema.parse({ reward: " $50 reward " })).toEqual({ ...empty, reward: "$50 reward" });
  });

  it("rejects an oversized reward", () => {
    expect(schema.safeParse({ reward: "x".repeat(81) }).success).toBe(false);
  });

  it("parse on read never throws", () => {
    for (const raw of [null, 1, "x", [], { reward: 5 }, { reward: "x".repeat(1000) }]) {
      expect(() => parse(raw)).not.toThrow();
    }
  });
});

describe("lost_pet schema", () => {
  it("parses a full profile", () => {
    expect(
      lostPetSchema.parse({
        petName: "Biscuit",
        breed: "Beagle",
        medicalNotes: "Needs insulin twice a day.\r\nFriendly.",
        vetName: "Riverside Vets",
        vetPhone: "+44 20 7946 0000",
        reward: "£100",
        photoKey: "pets/abc/biscuit.webp",
      }),
    ).toEqual({
      petName: "Biscuit",
      breed: "Beagle",
      medicalNotes: "Needs insulin twice a day.\nFriendly.",
      vetName: "Riverside Vets",
      vetPhone: "+442079460000",
      reward: "£100",
      photoKey: "pets/abc/biscuit.webp",
    });
  });

  it("rejects oversized and invalid fields", () => {
    expect(lostPetSchema.safeParse({ petName: "x".repeat(61) }).success).toBe(false);
    expect(lostPetSchema.safeParse({ medicalNotes: "x".repeat(501) }).success).toBe(false);
    expect(lostPetSchema.safeParse({ vetPhone: "vet" }).success).toBe(false);
    expect(lostPetSchema.safeParse({ medicalNotes: "owner: 07700 900123" }).success).toBe(false);
  });

  it("maps form data", () => {
    const fd = new FormData();
    fd.set("petName", "Biscuit");
    fd.set("vetPhone", "");
    fd.set("ownerPhone", "+14155552671");
    expect(lostPetSchema.parse(lostPetFromFormData(fd))).toEqual({ petName: "Biscuit" });
  });

  it("validates the vet phone per country and stores E.164", () => {
    expect(lostPetSchema.parse({ vetPhone: "+1 (415) 555-2671" }).vetPhone).toBe("+14155552671");
    expect(lostPetSchema.parse({ vetPhone: "0049 30 901820" }).vetPhone).toBe("+4930901820");
    expect(lostPetSchema.safeParse({ vetPhone: "030 901820" }).success).toBe(false);
    expect(lostPetSchema.safeParse({ vetPhone: "+1 555 123 4567" }).success).toBe(false);
  });

  it("blocks phone-like digit runs in free text", () => {
    expect(lostPetSchema.safeParse({ breed: "Beagle 0123456" }).success).toBe(false);
  });
});

describe("lost_device schema", () => {
  it("parses a full profile and keeps XSS-looking text as plain text", () => {
    const msg = `<img src=x onerror="alert(1)"> Please hand it in at reception.`;
    expect(lostDeviceSchema.parse({ nickname: "Work laptop", returnMessage: msg, reward: "Coffee on me" })).toEqual({
      nickname: "Work laptop",
      returnMessage: msg,
      reward: "Coffee on me",
    });
  });

  it("rejects oversized fields", () => {
    expect(validateLostDeviceData({ returnMessage: "x".repeat(501) }).success).toBe(false);
    expect(validateLostDeviceData({ nickname: "x".repeat(61) }).success).toBe(false);
  });

  it("maps form data", () => {
    const fd = new FormData();
    fd.set("nickname", "Phone");
    fd.set("returnMessage", "Thanks!");
    expect(lostDeviceSchema.parse(lostDeviceFromFormData(fd))).toEqual({ nickname: "Phone", returnMessage: "Thanks!" });
  });
});

describe("lost_id schema (never stores ID numbers, card numbers or addresses)", () => {
  it("has only a return message and a reward", () => {
    expect(Object.keys(lostIdSchema.shape).sort()).toEqual(["returnMessage", "reward"]);
  });

  const FORBIDDEN_KEYS = [
    "idNumber",
    "id_number",
    "documentNumber",
    "passportNumber",
    "licenseNumber",
    "driverLicense",
    "nationalId",
    "ssn",
    "cardNumber",
    "card_number",
    "pan",
    "cvv",
    "iban",
    "accountNumber",
    "address",
    "homeAddress",
    "street",
    "postcode",
    "zip",
    "dateOfBirth",
    "photoKey",
  ];

  it.each(FORBIDDEN_KEYS)("rejects %j on write and strips it on read", (key) => {
    const r = validateLostIdData({ returnMessage: "Please return it", [key]: "123456789" });
    expect(r.success).toBe(false);
    expect(parseLostIdData({ returnMessage: "Please return it", [key]: "123456789" })).toEqual({
      returnMessage: "Please return it",
    });
  });

  it.each([
    "Card 4111 1111 1111 1111",
    "4111-1111-1111-1111",
    "Passport 123456789",
    "SSN 123-45-6789",
    "ID no. 12345",
    "Return to 90210",
    "Account 12 34 56 78",
  ])("rejects number-like content in the return message: %j", (text) => {
    expect(lostIdSchema.safeParse({ returnMessage: text }).success).toBe(false);
  });

  it("allows an ordinary return message", () => {
    expect(
      lostIdSchema.parse({
        returnMessage: "Thanks for finding my wallet! Please use the button below.",
        reward: "$20",
      }),
    ).toEqual({ returnMessage: "Thanks for finding my wallet! Please use the button below.", reward: "$20" });
  });

  it("form mapping only reads the allowed fields", () => {
    const fd = new FormData();
    fd.set("returnMessage", "Please return");
    fd.set("cardNumber", "4111111111111111");
    fd.set("address", "1 Main St");
    expect(lostIdFromFormData(fd)).toEqual({ returnMessage: "Please return", reward: undefined });
  });
});
