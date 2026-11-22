import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AES_BLOCK, aesCbcDecrypt, aesCmac, assertAesKey, truncateMac } from "./cmac";
import { deriveSystemKey, derivePerTagKey, KEY_SLOT, UID_BYTES } from "./diversify";

/**
 * SUN (Secure Unique NFC) / SDM verification for NTAG 424 DNA, per NXP AN12196 section 3.4.
 *
 * The encoder writes this NDEF URI (see encoder/ and ./README.md):
 *   ${APP_BASE_URL}/t/{tagId}?picc={32 hex}&cmac={16 hex}
 * - picc = AES-128-CBC(SDMMetaReadKey, IV=0, PICCDataTag(C7) || UID(7) || SDMReadCtr(3, LSB first) || random(5))
 * - cmac = MACt(KSesSDMFileReadMAC, empty input)   (SDMMACInputOffset == SDMMACOffset)
 *   KSesSDMFileReadMAC = CMAC(SDMFileReadKey, SV2), SV2 = 3CC3 0001 0080 || UID || SDMReadCtr
 *
 * Verification only proves the tag produced these values. The caller must also check the UID
 * belongs to the tag in the URL and that the counter is strictly greater than tags.last_counter
 * (see ./counter.ts) — otherwise a recorded URL could be replayed.
 */

/** PICCDataTag for "UID mirrored + SDMReadCtr mirrored + UID length 7" (AN12196 3.4.2). */
export const PICC_DATA_TAG = 0xc7;

const hex = (len: number) =>
  z
    .string()
    .length(len)
    .regex(/^[0-9A-Fa-f]+$/, "must be hex");

export const sunParamsSchema = z.object({
  picc: hex(32),
  cmac: hex(16),
});

export type SunParams = z.infer<typeof sunParamsSchema>;

export interface PiccData {
  uid: Buffer;
  /** SDMReadCtr as an integer (the tag sends it LSB first). */
  counter: number;
  /** The raw 3 counter bytes as mirrored, needed for SV2. */
  counterBytes: Buffer;
}

/** Decrypt the `picc` value. Returns null if it doesn't decrypt to our PICCDataTag (wrong key or tampered). */
export function decryptPiccData(sdmMetaReadKey: Uint8Array, encrypted: Uint8Array): PiccData | null {
  assertAesKey(sdmMetaReadKey, "sdmMetaReadKey");
  if (encrypted.length !== AES_BLOCK) throw new RangeError("PICC data must be 16 bytes");
  const plain = aesCbcDecrypt(sdmMetaReadKey, Buffer.alloc(AES_BLOCK), encrypted);
  if (plain[0] !== PICC_DATA_TAG) return null;
  const uid = Buffer.from(plain.subarray(1, 1 + UID_BYTES));
  const counterBytes = Buffer.from(plain.subarray(1 + UID_BYTES, 4 + UID_BYTES));
  return { uid, counterBytes, counter: counterBytes.readUIntLE(0, 3) };
}

/** SV2 for the SDM MAC session key (AN12196 3.4.4.1): 3CC3 0001 0080 || UID || SDMReadCtr. */
export function sdmSessionVector2(uid: Uint8Array, counterBytes: Uint8Array): Buffer {
  if (uid.length !== UID_BYTES || counterBytes.length !== 3) throw new RangeError("bad UID or counter length");
  return Buffer.concat([Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]), uid, counterBytes]);
}

export function sdmSessionMacKey(sdmFileReadKey: Uint8Array, uid: Uint8Array, counterBytes: Uint8Array): Buffer {
  assertAesKey(sdmFileReadKey, "sdmFileReadKey");
  return aesCmac(sdmFileReadKey, sdmSessionVector2(uid, counterBytes));
}

/** The 8-byte SDMMAC over `macInput` (empty for our URL layout). */
export function sdmMac(sessionMacKey: Uint8Array, macInput: Uint8Array = Buffer.alloc(0)): Buffer {
  return truncateMac(aesCmac(sessionMacKey, macInput));
}

export interface SunKeyProvider {
  /** Decrypts the PICC data; the same for all tags so it can be used before the UID is known. */
  sdmMetaReadKey: Uint8Array;
  /** The per-tag MAC key for a UID (uppercase hex, 14 chars). May fetch or derive. */
  sdmFileReadKeyForUid(uidHex: string): Uint8Array | Promise<Uint8Array>;
}

/** Key provider that derives everything from the master key (see ./diversify.ts and ./keys.ts). */
export function keyProviderFromMasterKey(masterKey: Uint8Array): SunKeyProvider {
  return {
    sdmMetaReadKey: deriveSystemKey(masterKey, KEY_SLOT.sdmMetaRead),
    sdmFileReadKeyForUid: (uidHex) => derivePerTagKey(masterKey, Buffer.from(uidHex, "hex"), KEY_SLOT.sdmFileRead),
  };
}

export type VerifyTapResult =
  { ok: true; uid: string; counter: number } | { ok: false; reason: "invalid_format" | "bad_picc_data" | "bad_cmac" };

/**
 * Verify the `picc` and `cmac` query parameters of a tap.
 * Never throws on attacker-controlled input; returns a reason the caller may log (it contains no secrets).
 * Do not show the reason to visitors.
 */
export async function verifyTap(params: unknown, keys: SunKeyProvider): Promise<VerifyTapResult> {
  const parsed = sunParamsSchema.safeParse(params);
  if (!parsed.success) return { ok: false, reason: "invalid_format" };

  const picc = decryptPiccData(keys.sdmMetaReadKey, Buffer.from(parsed.data.picc, "hex"));
  if (!picc) return { ok: false, reason: "bad_picc_data" };

  const uidHex = picc.uid.toString("hex").toUpperCase();
  const fileReadKey = await keys.sdmFileReadKeyForUid(uidHex);
  const expected = sdmMac(sdmSessionMacKey(fileReadKey, picc.uid, picc.counterBytes));
  const received = Buffer.from(parsed.data.cmac, "hex");
  if (!timingSafeEqual(expected, received)) return { ok: false, reason: "bad_cmac" };

  return { ok: true, uid: uidHex, counter: picc.counter };
}
