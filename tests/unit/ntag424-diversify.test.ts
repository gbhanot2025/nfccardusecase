import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  an10922DiversifyAes128,
  derivePerTagKey,
  deriveSystemKey,
  deriveTagKeys,
  KEY_SLOT,
} from "@/server/ntag424/diversify";
import { keyProviderFromMasterKey, verifyTap } from "@/server/ntag424/sun";

const h = (s: string) => Buffer.from(s, "hex");
const HX = (b: Buffer) => b.toString("hex").toUpperCase();

/**
 * NXP AN10922 "Symmetric key diversifications", section 2.2.1 (AES-128 example).
 * Source: https://www.nxp.com/docs/en/application-note/AN10922.pdf
 *   K = 00112233445566778899AABBCCDDEEFF, UID 04782E21801D80, AID 3042F5, SystemIdentifier 4E585020416275 ("NXP Abu")
 *   M = UID || AID || SystemIdentifier, diversified key A8DD63A3B89D54B37CA802473FDA9175
 */
describe("AN10922 AES-128 diversification", () => {
  it("reproduces the published example", () => {
    const m = h("04782E21801D80" + "3042F5" + "4E585020416275");
    expect(HX(an10922DiversifyAes128(h("00112233445566778899AABBCCDDEEFF"), m))).toBe(
      "A8DD63A3B89D54B37CA802473FDA9175",
    );
  });

  it("enforces the 1..31 byte input length", () => {
    const k = Buffer.alloc(16);
    expect(() => an10922DiversifyAes128(k, Buffer.alloc(0))).toThrow(RangeError);
    expect(() => an10922DiversifyAes128(k, Buffer.alloc(32))).toThrow(RangeError);
    expect(() => an10922DiversifyAes128(k, Buffer.alloc(31))).not.toThrow();
  });
});

describe("project key derivation", () => {
  const master = h("000102030405060708090A0B0C0D0E0F");
  const uidA = h("04A1B2C3D4E5F6");
  const uidB = h("04A1B2C3D4E5F7");

  it("gives each tag its own MAC key but one shared meta-read key", () => {
    const a = deriveTagKeys(master, uidA);
    const b = deriveTagKeys(master, uidB);
    expect(a.sdmFileReadKey.equals(b.sdmFileReadKey)).toBe(false);
    expect(a.sdmMetaReadKey.equals(b.sdmMetaReadKey)).toBe(true);
  });

  it("gives every slot a different key", () => {
    const keys = [0, 1, 2, 3, 4].map((s) => HX(derivePerTagKey(master, uidA, s)));
    keys.push(HX(deriveSystemKey(master, KEY_SLOT.sdmMetaRead)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("rejects bad UIDs, slots and master keys", () => {
    expect(() => deriveTagKeys(master, h("04A1B2C3D4E5"))).toThrow(RangeError);
    expect(() => derivePerTagKey(master, uidA, 5)).toThrow(RangeError);
    expect(() => deriveTagKeys(Buffer.alloc(8), uidA)).toThrow(TypeError);
  });
});

/**
 * Shared with the Python encoder (encoder/tests/test_vectors_shared.py): both implementations must
 * derive the same keys and accept the same SUN taps, or encoded tags would never verify.
 * The SUN taps were produced by the encoder's NTAG 424 DNA simulator after a full personalization.
 */
interface SharedVectors {
  masterKey: string;
  derivation: { uid: string; slot: number | "system"; key: string }[];
  taps: { picc: string; cmac: string; uid: string; counter: number }[];
}
const shared = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests/fixtures/ntag424-vectors.json"), "utf8"),
) as SharedVectors;

describe("shared vectors with the Python encoder", () => {
  const master = h(shared.masterKey);

  it.each(shared.derivation)("derives slot $slot for UID $uid", ({ uid, slot, key }) => {
    const derived =
      slot === "system" ? deriveSystemKey(master, KEY_SLOT.sdmMetaRead) : derivePerTagKey(master, h(uid), slot);
    expect(HX(derived)).toBe(key);
  });

  it.each(shared.taps)("verifies a simulated tap with counter $counter", async ({ picc, cmac, uid, counter }) => {
    await expect(verifyTap({ picc, cmac }, keyProviderFromMasterKey(master))).resolves.toEqual({
      ok: true,
      uid,
      counter,
    });
  });

  it("rejects simulated taps under another master key", async () => {
    const other = keyProviderFromMasterKey(h("FF0102030405060708090A0B0C0D0E0F"));
    for (const { picc, cmac } of shared.taps) expect((await verifyTap({ picc, cmac }, other)).ok).toBe(false);
  });
});
