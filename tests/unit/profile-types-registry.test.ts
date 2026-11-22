import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BusinessCardEditor } from "@/profile-types/business_card/Editor";
import { LostDeviceEditor } from "@/profile-types/lost_device/Editor";
import { LostIdEditor } from "@/profile-types/lost_id/Editor";
import { LostPetEditor } from "@/profile-types/lost_pet/Editor";
import {
  PROFILE_TYPE_MODULES,
  PROFILE_TYPE_SCHEMAS,
  ProfileEditor,
  ProfilePublicPage,
  isProfileType,
  parseProfileDataFor,
  validateProfileDataFor,
  type ProfileDataMap,
  type ProfileTypeSchema,
} from "@/profile-types/modules";
import { PROFILE_TYPES, type ProfileType } from "@/profile-types/registry";
import type { EditorAction } from "@/profile-types/shared/types";

const noopAction: EditorAction = async () => ({ status: "saved" });

describe("profile type registry", () => {
  it("registers every profile type", () => {
    expect(Object.keys(PROFILE_TYPE_SCHEMAS).sort()).toEqual([...PROFILE_TYPES].sort());
    expect(Object.keys(PROFILE_TYPE_MODULES).sort()).toEqual([...PROFILE_TYPES].sort());
    for (const type of PROFILE_TYPES) {
      expect(PROFILE_TYPE_MODULES[type].type).toBe(type);
      expect(typeof PROFILE_TYPE_MODULES[type].PublicPage).toBe("function");
      expect(typeof PROFILE_TYPE_MODULES[type].Editor).toBe("function");
    }
  });

  function isEmptyAfterParse<K extends ProfileType>(type: K, raw: unknown): boolean {
    const s: ProfileTypeSchema<ProfileDataMap[K]> = PROFILE_TYPE_SCHEMAS[type];
    return s.isEmpty(parseProfileDataFor(type, raw));
  }

  it.each(PROFILE_TYPES)("%s accepts {} and reports it as empty", (type) => {
    const s = PROFILE_TYPE_SCHEMAS[type];
    expect(s.schema.safeParse({}).success).toBe(true);
    expect(validateProfileDataFor(type, {}).success).toBe(true);
    expect(isEmptyAfterParse(type, {})).toBe(true);
    expect(s.fromFormData(new FormData())).toBeTypeOf("object");
    expect(validateProfileDataFor(type, s.fromFormData(new FormData())).success).toBe(true);
  });

  it.each(PROFILE_TYPES)("%s never reads image keys from the form", (type) => {
    const fd = new FormData();
    fd.set("photoKey", "someone-else/photo.jpg");
    fd.set("logoKey", "someone-else/logo.png");
    const raw = PROFILE_TYPE_SCHEMAS[type].fromFormData(fd);
    expect(raw.photoKey).toBeUndefined();
    expect(raw.logoKey).toBeUndefined();
  });

  it("isProfileType guards unknown strings", () => {
    expect(isProfileType("lost_pet")).toBe(true);
    expect(isProfileType("medical_id")).toBe(false);
    expect(isProfileType(undefined)).toBe(false);
  });

  it.each(PROFILE_TYPES)("ProfilePublicPage renders %s from raw (even junk) data without throwing", (type) => {
    for (const data of [{}, null, "junk", { name: 5 }]) {
      const html = renderToStaticMarkup(
        createElement(ProfilePublicPage, { type, data, lostMode: type !== "business_card", vcardUrl: "/v.vcf" }),
      );
      expect(html).toContain("<main");
      expect(html).not.toMatch(/\sstyle=/i);
    }
  });

  it.each(PROFILE_TYPES)("ProfileEditor renders %s with parsed initial data", (type) => {
    const html = renderToStaticMarkup(createElement(ProfileEditor, { type, data: { junk: true }, action: noopAction }));
    expect(html).toContain("<form");
    expect(html).not.toMatch(/\sstyle=/i);
  });
});

describe("editors", () => {
  /** Every visible input has a <label for> pointing at it (Playwright getByLabel relies on this). */
  function expectLabelled(html: string, labels: string[]) {
    for (const label of labels) {
      const match = html.match(new RegExp(`<label for="([^"]+)">${label.replace(/[()]/g, "\\$&")}</label>`));
      expect(match, label).not.toBeNull();
      expect(html).toContain(`id="${match![1]}"`);
    }
    const ids = [...html.matchAll(/<(?:input|textarea|select)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    for (const id of ids) expect(html).toContain(`for="${id}"`);
  }

  it("business card editor has labelled fields with limits and existing values", () => {
    const html = renderToStaticMarkup(
      createElement(BusinessCardEditor, {
        action: noopAction,
        initialData: {
          name: "Jane <b>Doe</b>",
          phones: [{ label: "work", number: "+14155552671" }],
          emails: [{ label: "work", address: "jane@acme.example" }],
          socials: [{ network: "github", url: "https://github.com/jane" }],
        },
      }),
    );
    expectLabelled(html, [
      "Full name",
      "Job title",
      "Company",
      "About",
      "Phone type 1",
      "Phone number 1",
      "Email type 1",
      "Email address 1",
      "Website",
      "Company page",
      "Social network 1",
      "Social profile link 1",
    ]);
    expect(html).toContain('maxLength="100"');
    expect(html).toContain('value="Jane &lt;b&gt;Doe&lt;/b&gt;"');
    expect(html).toContain('name="phones.0.number"');
    expect(html).toContain("Add phone");
    expect(html).not.toContain("photoKey");
  });

  it("lost editors have labelled fields and no owner contact fields", () => {
    const pet = renderToStaticMarkup(createElement(LostPetEditor, { action: noopAction, initialData: {} }));
    expectLabelled(pet, ["Pet&#x27;s name", "Breed", "Medical notes", "Vet clinic", "Vet phone", "Reward (optional)"]);
    const device = renderToStaticMarkup(createElement(LostDeviceEditor, { action: noopAction, initialData: {} }));
    expectLabelled(device, ["Device nickname", "Return message", "Reward (optional)"]);
    const id = renderToStaticMarkup(createElement(LostIdEditor, { action: noopAction, initialData: {} }));
    expectLabelled(id, ["Return message", "Reward (optional)"]);
    expect([...id.matchAll(/\sname="([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["returnMessage", "reward"]);

    for (const html of [pet, device, id]) {
      for (const name of ["name", "ownerName", "email", "phone", "address", "photoKey"]) {
        expect(html).not.toContain(`name="${name}"`);
      }
    }
  });
});
