import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  emailAddress,
  formRows,
  httpsUrl,
  list,
  longestDigitRun,
  multiLineText,
  optionalStorageKey,
  parseProfileData,
  phoneNumber,
  singleLineText,
} from "@/profile-types/shared/fields";

describe("shared profile fields", () => {
  it("treats blank strings and null as not set", () => {
    const s = z.strictObject({ a: singleLineText(10) });
    expect(s.parse({ a: "   " })).toEqual({ a: undefined });
    expect(s.parse({ a: null })).toEqual({ a: undefined });
    expect(s.parse({})).toEqual({});
  });

  it("trims and limits single-line text, rejecting line breaks and control/bidi characters", () => {
    const f = singleLineText(5);
    expect(f.parse("  abc  ")).toBe("abc");
    expect(f.safeParse("abcdef").success).toBe(false);
    for (const bad of ["a\nb", "a\rb", "a\tb", "a\u0000b", "a\u2028b", "a\u202eb", "a\u0085b"]) {
      expect(f.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("normalises line endings in multi-line text and limits line count", () => {
    const f = multiLineText(1000);
    expect(f.parse("a\r\nb\rc")).toBe("a\nb\nc");
    expect(f.safeParse("x\n".repeat(25)).success).toBe(false);
    expect(f.safeParse("a\u0000b").success).toBe(false);
  });

  it.each([
    ["+44 20 7946 0958", "+442079460958"],
    ["(555) 123-4567", "5551234567"],
    ["0044 20 7946 0958", "+442079460958"],
    ["+1.555.123.4567", "+15551234567"],
  ])("normalises phone %j", (input, expected) => {
    expect(phoneNumber.parse(input)).toBe(expected);
  });

  it.each(["12345", "+1234567890123456", "call me", "+44 20 7946 0958 ext 2", "555-CALL-NOW", "+1\n5551234567"])(
    "rejects phone %j",
    (input) => {
      expect(phoneNumber.safeParse(input).success).toBe(false);
    },
  );

  it("normalises emails and rejects invalid ones", () => {
    expect(emailAddress.parse("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    for (const bad of ["jane", "jane@", "@x.com", "a b@x.com", `${"a".repeat(250)}@x.com`, "a@x.com\nBcc: b@x.com"]) {
      expect(emailAddress.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("accepts only https URLs and adds the scheme when missing", () => {
    expect(httpsUrl.parse("example.com/me")).toBe("https://example.com/me");
    expect(httpsUrl.parse("https://Example.com")).toBe("https://example.com/");
    for (const bad of [
      "http://example.com",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://example.com",
      "https://user:pass@example.com",
      "https://localhost",
      "https://127.0.0.1",
      "https://exa mple.com",
      `https://example.com/${"a".repeat(600)}`,
    ]) {
      expect(httpsUrl.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("validates storage keys strictly", () => {
    expect(optionalStorageKey.parse("profiles/abc_123/photo-1.jpg")).toBe("profiles/abc_123/photo-1.jpg");
    for (const bad of [
      "../etc/passwd.jpg",
      "/abs/photo.jpg",
      "a//b.jpg",
      "https://evil.example/x.png",
      "photo.svg",
      "photo.jpg?x=1",
      "a/./b.png",
      "photo.html",
    ]) {
      expect(optionalStorageKey.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("counts phone/ID-like digit runs", () => {
    expect(longestDigitRun("Reward $50")).toBe(2);
    expect(longestDigitRun("call 555 123-4567")).toBe(10);
    expect(longestDigitRun("4111 1111 1111 1111")).toBe(16);
    expect(longestDigitRun("10, 20, 30")).toBe(2);
  });

  it("parseProfileData never throws and salvages valid fields and list items", () => {
    const shape = { a: singleLineText(5), b: list(z.strictObject({ n: phoneNumber }), 2) };
    expect(parseProfileData(shape, null)).toEqual({});
    expect(parseProfileData(shape, "junk")).toEqual({});
    expect(parseProfileData(shape, [1, 2])).toEqual({});
    expect(parseProfileData(shape, { a: "toolong", b: [{ n: "+15551234567" }, { n: "x" }], extra: 1 })).toEqual({
      b: [{ n: "+15551234567" }],
    });
    expect(parseProfileData(shape, { a: "ok", b: "not-a-list" })).toEqual({ a: "ok" });
    expect(
      parseProfileData(shape, { b: [{ n: "+15551234561" }, { n: "+15551234562" }, { n: "+15551234563" }, {}] }),
    ).toEqual({ b: [{ n: "+15551234561" }, { n: "+15551234562" }] });
  });

  it("formRows skips empty rows and stops one past the limit", () => {
    const fd = new FormData();
    fd.set("p.0.label", "work");
    fd.set("p.0.number", "");
    fd.set("p.1.number", "123");
    fd.set("p.3.number", "456");
    fd.set("p.4.number", "789");
    expect(formRows(fd, "p", ["label", "number"], "number", 1)).toEqual([
      { label: undefined, number: "123" },
      { label: undefined, number: "456" },
    ]);
  });
});
