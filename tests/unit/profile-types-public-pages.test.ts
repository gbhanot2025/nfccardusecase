import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BusinessCardPublicPage } from "@/profile-types/business_card/PublicPage";
import { parseBusinessCardData } from "@/profile-types/business_card/schema";
import { LostDevicePublicPage } from "@/profile-types/lost_device/PublicPage";
import { parseLostDeviceData } from "@/profile-types/lost_device/schema";
import { LostIdPublicPage } from "@/profile-types/lost_id/PublicPage";
import { parseLostIdData } from "@/profile-types/lost_id/schema";
import { LostPetPublicPage } from "@/profile-types/lost_pet/PublicPage";
import { parseLostPetData } from "@/profile-types/lost_pet/schema";
import { safeImageSrc } from "@/profile-types/shared/ProfileImage";

/**
 * Data an attacker (or a bug) might have stored next to the real fields. The parse helpers must drop it
 * so it can never reach a lost-item page.
 */
const PRIVATE = {
  ownerName: "Olivia Owner",
  name: "Olivia Owner",
  email: "olivia@private.example",
  ownerEmail: "olivia@private.example",
  phone: "+15550001111",
  ownerPhone: "+15550001111",
  address: "1 Secret Lane",
  idNumber: "X1234567",
  cardNumber: "4111111111111111",
};
const PRIVATE_VALUES = [
  "Olivia",
  "olivia@private.example",
  "+15550001111",
  "5550001111",
  "Secret Lane",
  "X1234567",
  "4111111111111111",
];

const XSS = `<script>alert(1)</script><img src=x onerror=alert(2)>`;

function render(element: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(element);
}

function expectSafeMarkup(html: string) {
  expect(html).not.toMatch(/\sstyle=/i);
  expect(html).not.toMatch(/<script/i);
  // Event-handler attributes, ignoring (escaped) text inside attribute values.
  expect(html.replace(/"[^"]*"/g, '""')).not.toMatch(/<[^>]*\son[a-z]+=/i);
  expect(html).not.toMatch(/javascript:/i);
}

const actions = createElement("button", { type: "button" }, "Message owner");

const lostCases = [
  {
    type: "lost_pet",
    render: (raw: unknown, lostMode: boolean) =>
      render(
        createElement(LostPetPublicPage, { data: parseLostPetData(raw), lostMode, photoUrl: "/media/p.jpg" }, actions),
      ),
    full: {
      petName: "Biscuit",
      breed: "Beagle",
      medicalNotes: "Needs insulin",
      vetName: "Riverside Vets",
      vetPhone: "+442079460000",
      reward: "£100",
    },
    lostOnly: ["Needs insulin", "Riverside Vets", "£100", "I found this pet"],
    always: ["Biscuit", "Beagle", "Message owner"],
  },
  {
    type: "lost_device",
    render: (raw: unknown, lostMode: boolean) =>
      render(createElement(LostDevicePublicPage, { data: parseLostDeviceData(raw), lostMode }, actions)),
    full: { nickname: "Work laptop", returnMessage: "Please hand in at reception", reward: "Coffee on me" },
    lostOnly: ["Coffee on me", "Please return this device"],
    always: ["Work laptop", "Please hand in at reception", "Message owner"],
  },
  {
    type: "lost_id",
    render: (raw: unknown, lostMode: boolean) =>
      render(createElement(LostIdPublicPage, { data: parseLostIdData(raw), lostMode }, actions)),
    full: { returnMessage: "Thanks for finding my wallet", reward: "$20" },
    lostOnly: ["$20", 'role="alert"'],
    always: ["Thanks for finding my wallet", "You found a lost wallet/ID", "Message owner"],
  },
] as const;

describe.each(lostCases)("$type public page", ({ render: renderPage, full, lostOnly, always }) => {
  it.each([true, false])("never leaks private fields (lostMode=%s)", (lostMode) => {
    const html = renderPage({ ...full, ...PRIVATE }, lostMode);
    for (const value of PRIVATE_VALUES) expect(html).not.toContain(value);
    expect(html).not.toContain("mailto:");
    expectSafeMarkup(html);
  });

  it("shows the urgent banner and reward only in lost mode", () => {
    const on = renderPage(full, true);
    const off = renderPage(full, false);
    for (const text of lostOnly) {
      expect(on).toContain(text);
      expect(off).not.toContain(text);
    }
    for (const text of always) {
      expect(on).toContain(text);
      expect(off).toContain(text);
    }
  });

  it("renders the not-set-up state from {} and from junk", () => {
    for (const raw of [{}, null, "junk", { reward: 5 }]) {
      for (const lostMode of [true, false]) {
        const html = renderPage(raw, lostMode);
        expect(html).toContain("<main");
        expectSafeMarkup(html);
      }
    }
  });

  it("escapes XSS-looking text", () => {
    const html = renderPage(
      { petName: XSS.slice(0, 60), nickname: XSS.slice(0, 60), returnMessage: XSS, reward: XSS.slice(0, 80) },
      true,
    );
    expectSafeMarkup(html);
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("business_card public page", () => {
  const data = parseBusinessCardData({
    name: "Jane Doe",
    title: "Head of Product",
    company: "Acme",
    bio: "Hello\nWorld",
    phones: [{ label: "mobile", number: "+14155552671" }],
    emails: [{ label: "work", address: "jane@acme.example" }],
    website: "https://jane.example",
    companyUrl: "https://acme.example",
    socials: [{ network: "linkedin", url: "https://www.linkedin.com/in/jane" }],
  });

  it("renders the full profile and a Save contact link", () => {
    const html = render(
      createElement(BusinessCardPublicPage, {
        data,
        vcardUrl: "/t/abc/contact.vcf",
        photoUrl: "/media/jane.jpg",
        logoUrl: "https://cdn.example/logo.png",
      }),
    );
    for (const text of [
      "Jane Doe",
      "Head of Product · Acme",
      "tel:+14155552671",
      "+1 415 555 2671",
      "mailto:jane@acme.example",
      'href="https://jane.example/"',
      'href="https://www.linkedin.com/in/jane"',
      "LinkedIn",
      'href="/t/abc/contact.vcf"',
      "Save contact",
      'src="/media/jane.jpg"',
      'src="https://cdn.example/logo.png"',
    ]) {
      expect(html).toContain(text);
    }
    expectSafeMarkup(html);
  });

  it("shows a not-set-up message for {}", () => {
    const html = render(createElement(BusinessCardPublicPage, { data: parseBusinessCardData({}), vcardUrl: "/x.vcf" }));
    expect(html).toContain("isn&#x27;t set up yet");
    expect(html).not.toContain("Save contact");
  });

  it("escapes XSS-looking text and drops unsafe URLs", () => {
    const html = render(
      createElement(BusinessCardPublicPage, {
        data: parseBusinessCardData({ name: XSS.slice(0, 100), bio: XSS, website: "javascript:alert(1)" }),
        photoUrl: "javascript:alert(1)",
        logoUrl: "//evil.example/x.png",
      }),
    );
    expectSafeMarkup(html);
    expect(html).not.toContain("evil.example");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not render a zero for empty contact lists", () => {
    const html = render(createElement(BusinessCardPublicPage, { data: { name: "Jane", phones: [], emails: [] } }));
    expect(html).not.toMatch(/>0</);
  });
});

describe("safeImageSrc", () => {
  it.each([
    ["/media/a.jpg", "/media/a.jpg"],
    ["https://cdn.example/a.jpg", "https://cdn.example/a.jpg"],
    ["//evil.example/a.jpg", undefined],
    ["/\\evil.example/a.jpg", undefined],
    ["http://cdn.example/a.jpg", undefined],
    ["javascript:alert(1)", undefined],
    ["data:image/svg+xml,<svg onload=alert(1)>", undefined],
    [undefined, undefined],
  ])("%j → %j", (input, expected) => {
    expect(safeImageSrc(input)).toBe(expected);
  });
});
