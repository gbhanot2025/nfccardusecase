import { describe, expect, it } from "vitest";
import {
  businessCardFromFormData,
  businessCardSchema,
  isBusinessCardEmpty,
  parseBusinessCardData,
  validateBusinessCardData,
} from "@/profile-types/business_card/schema";

const valid = {
  name: "  Jane Doe ",
  title: "Head of Product",
  company: "Acme, Inc.",
  bio: "Line one\r\nLine two",
  phones: [{ label: "mobile", number: "+44 20 7946 0958" }],
  emails: [{ label: "work", address: "Jane@Acme.example" }],
  website: "jane.example",
  companyUrl: "https://acme.example/about",
  socials: [
    { network: "linkedin", url: "https://www.linkedin.com/in/jane" },
    { network: "github", url: "github.com/jane" },
  ],
  photoKey: "profiles/p1/photo.jpg",
};

describe("business_card schema", () => {
  it("accepts {} (a freshly claimed, not set up profile)", () => {
    expect(businessCardSchema.parse({})).toEqual({});
    expect(isBusinessCardEmpty(parseBusinessCardData({}))).toBe(true);
  });

  it("parses and normalises a full profile", () => {
    const data = businessCardSchema.parse(valid);
    expect(data.name).toBe("Jane Doe");
    expect(data.bio).toBe("Line one\nLine two");
    expect(data.phones).toEqual([{ label: "mobile", number: "+442079460958" }]);
    expect(data.emails).toEqual([{ label: "work", address: "jane@acme.example" }]);
    expect(data.website).toBe("https://jane.example/");
    expect(data.socials?.[1]).toEqual({ network: "github", url: "https://github.com/jane" });
    expect(isBusinessCardEmpty(data)).toBe(false);
  });

  it("rejects unknown keys on write and drops them on read", () => {
    expect(businessCardSchema.safeParse({ name: "A", isAdmin: true }).success).toBe(false);
    expect(parseBusinessCardData({ name: "A", isAdmin: true })).toEqual({ name: "A" });
  });

  it.each([
    ["oversized name", { name: "x".repeat(101) }],
    ["oversized bio", { bio: "x".repeat(501) }],
    ["newline in name", { name: "Jane\r\nEMAIL:evil@example.com" }],
    ["http website", { website: "http://jane.example" }],
    ["javascript website", { website: "javascript:alert(document.cookie)" }],
    ["too many phones", { phones: Array.from({ length: 4 }, () => ({ number: "+14155552671" })) }],
    ["invalid phone label", { phones: [{ label: "<b>", number: "+14155552671" }] }],
    ["national phone number", { phones: [{ number: "020 7946 0958" }] }],
    ["phone that does not exist", { phones: [{ number: "+1 555 123 4567" }] }],
    ["invalid email", { emails: [{ address: "not-an-email" }] }],
    ["unknown network", { socials: [{ network: "myspace", url: "https://myspace.com/jane" }] }],
    ["social URL for another host", { socials: [{ network: "linkedin", url: "https://evil.example/in/jane" }] }],
    ["social lookalike host", { socials: [{ network: "linkedin", url: "https://linkedin.com.evil.example/x" }] }],
    ["http social URL", { socials: [{ network: "github", url: "http://github.com/jane" }] }],
    ["photo URL instead of key", { photoKey: "https://evil.example/x.jpg" }],
    ["non-object data", "hello"],
  ])("rejects %s", (_label, input) => {
    expect(businessCardSchema.safeParse(input).success).toBe(false);
  });

  it("reports field errors by path", () => {
    const r = validateBusinessCardData({ name: "x".repeat(101), phones: [{ number: "abc" }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(Object.keys(r.fieldErrors).sort()).toEqual(["name", "phones.0.number"]);
    }
  });

  it("keeps XSS-looking strings as plain text (escaping is React's job)", () => {
    const xss = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
    expect(businessCardSchema.parse({ name: xss.slice(0, 100) }).name).toBe(xss.slice(0, 100));
  });

  it("parse on read never throws and keeps the valid fields", () => {
    for (const raw of [null, undefined, 42, "x", [], { phones: "x" }, { name: { nested: true } }]) {
      expect(() => parseBusinessCardData(raw)).not.toThrow();
    }
    expect(
      parseBusinessCardData({
        name: "Jane",
        website: "javascript:alert(1)",
        phones: [{ number: "+14155552671" }, { number: "nope" }],
      }),
    ).toEqual({ name: "Jane", phones: [{ label: "mobile", number: "+14155552671" }] });
  });

  it("maps form data, skipping empty rows", () => {
    const fd = new FormData();
    fd.set("name", "Jane");
    fd.set("phones.0.label", "work");
    fd.set("phones.0.number", "+1 415 555 2671");
    fd.set("phones.1.label", "mobile");
    fd.set("phones.1.number", "");
    fd.set("socials.0.network", "x");
    fd.set("socials.0.url", "x.com/jane");
    fd.set("$ACTION_ID_abc", "ignored");
    const r = validateBusinessCardData(businessCardFromFormData(fd));
    expect(r).toEqual({
      success: true,
      data: {
        name: "Jane",
        phones: [{ label: "work", number: "+14155552671" }],
        emails: [],
        socials: [{ network: "x", url: "https://x.com/jane" }],
      },
    });
  });
});
