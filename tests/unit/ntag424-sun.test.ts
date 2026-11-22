import { describe, expect, it } from "vitest";
import { aesCmac } from "@/server/ntag424/cmac";
import {
  decryptPiccData,
  sdmMac,
  sdmSessionMacKey,
  sdmSessionVector2,
  verifyTap,
  type SunKeyProvider,
} from "@/server/ntag424/sun";

const h = (s: string) => Buffer.from(s, "hex");
const HX = (b: Buffer) => b.toString("hex").toUpperCase();

/**
 * NXP AN12196 "NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints", Rev. 2.0.
 * Source: https://www.nxp.jp/docs/en/application-note/AN12196.pdf (mirror of nxp.com/docs/en/application-note/AN12196.pdf)
 * Section 3.4.2.2 / Table 2 (PICCData decryption) and 3.4.4.2.1 / Table 4 (SDMMAC, empty MAC input):
 *   URL  https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086
 *   SDMMetaReadKey = SDMFileReadKey = 00..00 (factory keys)
 */
const AN12196 = {
  picc: "EF963FF7828658A599F3041510671E88",
  cmac: "94EED9EE65337086",
  piccPlain: "C704DE5F1EACC0403D0000DA5CF60941",
  uid: "04DE5F1EACC040",
  counterBytes: "3D0000",
  counter: 0x3d,
  sv2: "3CC30001008004DE5F1EACC0403D0000",
  sessionMacKey: "3FB5F6E3A807A03D5E3570ACE393776F",
};
const ZERO_KEY = Buffer.alloc(16);

const zeroKeys: SunKeyProvider = { sdmMetaReadKey: ZERO_KEY, sdmFileReadKeyForUid: () => ZERO_KEY };

describe("AN12196 SUN example (empty MAC input)", () => {
  it("decrypts the PICC data", () => {
    const picc = decryptPiccData(ZERO_KEY, h(AN12196.picc));
    expect(picc).not.toBeNull();
    expect(HX(picc!.uid)).toBe(AN12196.uid);
    expect(HX(picc!.counterBytes)).toBe(AN12196.counterBytes);
    expect(picc!.counter).toBe(AN12196.counter);
  });

  it("builds SV2 and the session MAC key", () => {
    expect(HX(sdmSessionVector2(h(AN12196.uid), h(AN12196.counterBytes)))).toBe(AN12196.sv2);
    expect(HX(sdmSessionMacKey(ZERO_KEY, h(AN12196.uid), h(AN12196.counterBytes)))).toBe(AN12196.sessionMacKey);
  });

  it("computes the truncated SDMMAC", () => {
    expect(HX(sdmMac(h(AN12196.sessionMacKey)))).toBe(AN12196.cmac);
  });

  it("verifies the tap", async () => {
    await expect(verifyTap({ picc: AN12196.picc, cmac: AN12196.cmac }, zeroKeys)).resolves.toEqual({
      ok: true,
      uid: AN12196.uid,
      counter: AN12196.counter,
    });
  });

  it("accepts lowercase hex", async () => {
    const r = await verifyTap({ picc: AN12196.picc.toLowerCase(), cmac: AN12196.cmac.toLowerCase() }, zeroKeys);
    expect(r.ok).toBe(true);
  });

  it("asks the key provider for the decrypted UID", async () => {
    const asked: string[] = [];
    await verifyTap(
      { picc: AN12196.picc, cmac: AN12196.cmac },
      { sdmMetaReadKey: ZERO_KEY, sdmFileReadKeyForUid: async (uid) => (asked.push(uid), ZERO_KEY) },
    );
    expect(asked).toEqual([AN12196.uid]);
  });
});

/** AN12196 section 3.4.4.2.2 / Table 5: MAC over "<enc>&cmac=" (non-empty MAC input). */
describe("AN12196 SDMMAC with MAC input", () => {
  it("matches the published session key and MAC", () => {
    const sessionKey = sdmSessionMacKey(ZERO_KEY, h("04958CAA5C5E80"), h("080000"));
    expect(HX(sessionKey)).toBe("3ED0920E5E6A0320D823D5987FEAFBB1");
    const input = Buffer.from("CEE9A53E3E463EF1F459635736738962&cmac=", "ascii");
    expect(HX(aesCmac(sessionKey, input))).toBe("81EC45C175E72FF6FAC61BC7AB3BAEF6");
    expect(HX(sdmMac(sessionKey, input))).toBe("ECC1E7F6C6C73BF6");
  });
});

describe("verifyTap rejects bad taps", () => {
  const good = { picc: AN12196.picc, cmac: AN12196.cmac };

  it("rejects a tampered cmac (every single-nibble change)", async () => {
    for (let i = 0; i < 16; i++) {
      const flipped = (parseInt(good.cmac[i], 16) ^ 0x1).toString(16).toUpperCase();
      const cmac = good.cmac.slice(0, i) + flipped + good.cmac.slice(i + 1);
      await expect(verifyTap({ ...good, cmac }, zeroKeys)).resolves.toEqual({ ok: false, reason: "bad_cmac" });
    }
  });

  it("rejects tampered PICC data", async () => {
    const picc = "0" + good.picc.slice(1);
    const r = await verifyTap({ ...good, picc }, zeroKeys);
    expect(r.ok).toBe(false);
  });

  it("rejects the right data with the wrong MAC key", async () => {
    const wrong = Buffer.alloc(16, 1);
    const r = await verifyTap(good, { sdmMetaReadKey: ZERO_KEY, sdmFileReadKeyForUid: () => wrong });
    expect(r).toEqual({ ok: false, reason: "bad_cmac" });
  });

  it("rejects PICC data encrypted with another meta-read key", async () => {
    const r = await verifyTap(good, { sdmMetaReadKey: Buffer.alloc(16, 1), sdmFileReadKeyForUid: () => ZERO_KEY });
    expect(r.ok).toBe(false);
  });

  it.each([
    ["missing params", {}],
    ["null", null],
    ["a string", "picc=x"],
    ["non-hex picc", { ...good, picc: "Z" + good.picc.slice(1) }],
    ["non-hex cmac", { ...good, cmac: "g" + good.cmac.slice(1) }],
    ["short picc", { ...good, picc: good.picc.slice(2) }],
    ["long picc", { ...good, picc: good.picc + "00" }],
    ["short cmac", { ...good, cmac: good.cmac.slice(1) }],
    ["long cmac (full 16-byte MAC)", { ...good, cmac: good.cmac + good.cmac }],
    ["array params", { picc: [good.picc], cmac: [good.cmac] }],
    ["whitespace", { ...good, cmac: ` ${good.cmac.slice(1)}` }],
    ["0x prefix", { ...good, picc: "0x" + good.picc.slice(2) }],
  ])("rejects bad format: %s", async (_name, params) => {
    await expect(verifyTap(params, zeroKeys)).resolves.toEqual({ ok: false, reason: "invalid_format" });
  });

  it("does not call the key provider for malformed or undecryptable input", async () => {
    let calls = 0;
    const keys: SunKeyProvider = { sdmMetaReadKey: ZERO_KEY, sdmFileReadKeyForUid: () => (calls++, ZERO_KEY) };
    await verifyTap({ picc: "xx", cmac: good.cmac }, keys);
    expect(calls).toBe(0);
  });
});
