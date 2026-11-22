import "server-only";
import { aesCmac, assertAesKey } from "./cmac";

/**
 * AES-128 key diversification per NXP AN10922 (section 2.2):
 *   diversified = CMAC(masterKey, 0x01 || M)   with 1 <= len(M) <= 31
 * CMAC's own padding (0x80 00..) and K1/K2 selection match the AN10922 steps exactly,
 * so the published example (A8DD63A3...) is reproduced by plain CMAC.
 */
export const AN10922_AES128_DIV_CONSTANT = 0x01;

export function an10922DiversifyAes128(masterKey: Uint8Array, diversificationInput: Uint8Array): Buffer {
  assertAesKey(masterKey, "masterKey");
  if (diversificationInput.length < 1 || diversificationInput.length > 31) {
    throw new RangeError("AN10922 diversification input must be 1..31 bytes");
  }
  return aesCmac(masterKey, Buffer.concat([Buffer.from([AN10922_AES128_DIV_CONSTANT]), diversificationInput]));
}

/**
 * Our system identifier, appended to every diversification input (the "system identifier" of AN10922).
 * Changing it changes every key: never edit it for existing tags. The Python encoder uses the same value
 * (encoder/src/ntag424_encoder/crypto.py); tests/fixtures/ntag424-vectors.json pins both implementations.
 */
export const SYSTEM_IDENTIFIER = Buffer.from("TagPlatformNTAG424v1", "ascii");

/** NTAG 424 DNA application key slots as the encoder configures them. */
export const KEY_SLOT = {
  /** Application master key: changes keys and file settings. Encoder only, never needed by the server. */
  appMaster: 0,
  /** SDMFileReadKey: per-tag; its session key signs the SUN CMAC (also SDMCtrRet). */
  sdmFileRead: 1,
  /** SDMMetaReadKey: system-wide; encrypts the PICC data (UID + counter). */
  sdmMetaRead: 2,
} as const;

const PER_TAG_PREFIX = 0x54; // "T"
const SYSTEM_WIDE_PREFIX = 0x53; // "S"

export const UID_BYTES = 7;

function assertUid(uid: Uint8Array): void {
  if (uid.length !== UID_BYTES) throw new RangeError("NTAG 424 DNA UID must be 7 bytes");
}

/** Per-tag key for a slot: M = "T" || UID(7) || slot(1) || SYSTEM_IDENTIFIER (29 bytes). */
export function derivePerTagKey(masterKey: Uint8Array, uid: Uint8Array, slot: number): Buffer {
  assertUid(uid);
  if (!Number.isInteger(slot) || slot < 0 || slot > 4) throw new RangeError("key slot must be 0..4");
  const m = Buffer.concat([Buffer.from([PER_TAG_PREFIX]), uid, Buffer.from([slot]), SYSTEM_IDENTIFIER]);
  return an10922DiversifyAes128(masterKey, m);
}

/**
 * System-wide key for a slot: M = "S" || slot(1) || SYSTEM_IDENTIFIER (22 bytes).
 * Used for the SDM meta-read key only: the server must decrypt the PICC data to learn the UID
 * before it can derive any per-tag key, so this key cannot depend on the UID. It only hides
 * UID/counter from observers; authenticity comes from the per-tag file-read (MAC) key.
 */
export function deriveSystemKey(masterKey: Uint8Array, slot: number): Buffer {
  if (!Number.isInteger(slot) || slot < 0 || slot > 4) throw new RangeError("key slot must be 0..4");
  const m = Buffer.concat([Buffer.from([SYSTEM_WIDE_PREFIX, slot]), SYSTEM_IDENTIFIER]);
  return an10922DiversifyAes128(masterKey, m);
}

export interface TagKeys {
  /** Decrypts the `picc` parameter. Same for every tag (see deriveSystemKey). */
  sdmMetaReadKey: Buffer;
  /** Per-tag key whose session key verifies the `cmac` parameter. */
  sdmFileReadKey: Buffer;
}

/** Keys the server needs to verify taps of the tag with this UID. */
export function deriveTagKeys(masterKey: Uint8Array, uid: Uint8Array): TagKeys {
  return {
    sdmMetaReadKey: deriveSystemKey(masterKey, KEY_SLOT.sdmMetaRead),
    sdmFileReadKey: derivePerTagKey(masterKey, uid, KEY_SLOT.sdmFileRead),
  };
}
