import { describe, expect, it } from "vitest";
import {
  formatClaimCode,
  newClaimCode,
  newPublicCode,
  newTagId,
  normalizeClaimCode,
  normalizePublicCode,
  PUBLIC_CODE_PATTERN,
  TAG_ID_PATTERN,
} from "@/server/codes";

describe("generated codes", () => {
  it("match their formats and don't repeat", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = newTagId();
      expect(id).toMatch(TAG_ID_PATTERN);
      ids.add(id);
      expect(newPublicCode()).toMatch(PUBLIC_CODE_PATTERN);
    }
    expect(ids.size).toBe(2000);
  });

  it("never use look-alike letters", () => {
    const sample = Array.from({ length: 500 }, () => newClaimCode() + newPublicCode() + newTagId()).join("");
    expect(sample).not.toMatch(/[ILOUilou]/);
  });
});

describe("claim code input", () => {
  it("accepts what people actually type", () => {
    const code = newClaimCode();
    expect(normalizeClaimCode(formatClaimCode(code))).toBe(code);
    expect(normalizeClaimCode(` ${code.slice(0, 5).toLowerCase()} - ${code.slice(5)} `)).toBe(code);
    expect(normalizeClaimCode("ABCDE-FGH0O")).toBe("ABCDEFGH00");
    expect(normalizeClaimCode("abcde fghil")).toBe("ABCDEFGH11");
  });

  it("rejects anything that can't be a claim code", () => {
    for (const bad of ["", "ABCDE", "ABCDE-FGHJKM", "ABCDE-FGHJ!", "ABCDE-FGHJU", "ÄBCDE-FGHJK"]) {
      expect(normalizeClaimCode(bad)).toBeNull();
    }
  });

  it("formats as two groups of five", () => {
    expect(formatClaimCode("ABCDE12345")).toBe("ABCDE-12345");
  });
});

describe("public codes", () => {
  it("are case-insensitive and strictly validated", () => {
    expect(normalizePublicCode("ab7k9qxm2z")).toBe("AB7K9QXM2Z");
    expect(normalizePublicCode("AB7K9QXM2")).toBeNull();
    expect(normalizePublicCode("AB7K9QXM2U")).toBeNull();
    expect(normalizePublicCode("../../etc")).toBeNull();
  });
});
