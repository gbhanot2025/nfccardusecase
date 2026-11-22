import { describe, expect, it } from "vitest";
import { aesCmac, cmacSubkeys, truncateMac } from "@/server/ntag424/cmac";

const h = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "hex");
const hx = (b: Buffer) => b.toString("hex");

/**
 * NIST SP 800-38B (May 2005), Appendix D.1 "AES-128" — the same values are in RFC 4493 section 4.
 * Source: https://www.govinfo.gov/content/pkg/GOVPUB-C13-f05b7969a96dff6e1fae82057f5c211d/pdf/GOVPUB-C13-f05b7969a96dff6e1fae82057f5c211d.pdf
 * (NIST later moved the examples to the CSRC examples page; values are unchanged.)
 */
describe("AES-128 CMAC (NIST SP 800-38B D.1)", () => {
  const key = h("2b7e1516 28aed2a6 abf71588 09cf4f3c");
  const m512 = h(`6bc1bee2 2e409f96 e93d7e11 7393172a
                  ae2d8a57 1e03ac9c 9eb76fac 45af8e51
                  30c81c46 a35ce411 e5fbc119 1a0a52ef
                  f69f2445 df4f9b17 ad2b417b e66c3710`);

  it("derives the subkeys", () => {
    const { k1, k2 } = cmacSubkeys(key);
    expect(hx(k1)).toBe("fbeed618357133667c85e08f7236a8de");
    expect(hx(k2)).toBe("f7ddac306ae266ccf90bc11ee46d513b");
  });

  it.each([
    ["Example 1, Mlen = 0", 0, "bb1d6929e95937287fa37d129b756746"],
    ["Example 2, Mlen = 128", 16, "070a16b46b4d4144f79bdd9dd04a287c"],
    ["Example 3, Mlen = 320", 40, "dfa66747de9ae63030ca32611497c827"],
    ["Example 4, Mlen = 512", 64, "51f0bebf7e3b9d92fc49741779363cfe"],
  ])("%s", (_name, bytes, tag) => {
    expect(hx(aesCmac(key, m512.subarray(0, bytes)))).toBe(tag);
  });

  it("rejects keys that are not 16 bytes", () => {
    expect(() => aesCmac(Buffer.alloc(15), Buffer.alloc(0))).toThrow(/16-byte/);
    expect(() => aesCmac(Buffer.alloc(32), Buffer.alloc(0))).toThrow(/16-byte/);
  });
});

describe("NXP MAC truncation", () => {
  // AN12196 Table 5: SDMMACfull 81EC45C1... -> SDMMAC ECC1E7F6C6C73BF6 (bytes at odd indices).
  it("keeps the odd bytes, in order", () => {
    expect(hx(truncateMac(h("81EC45C175E72FF6FAC61BC7AB3BAEF6"))).toUpperCase()).toBe("ECC1E7F6C6C73BF6");
  });
});
