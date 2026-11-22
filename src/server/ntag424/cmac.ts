import "server-only";
import { createCipheriv, createDecipheriv } from "node:crypto";

/** AES-128 primitives on `node:crypto` (no extra dependency). Every key is exactly 16 bytes. */
export const AES_BLOCK = 16;

export function assertAesKey(key: Uint8Array, name = "key"): void {
  if (!(key instanceof Uint8Array) || key.length !== AES_BLOCK) {
    throw new TypeError(`${name} must be a 16-byte AES-128 key`);
  }
}

/** Encrypt exactly one 16-byte block (AES-128-ECB, no padding). */
export function aesEncryptBlock(key: Uint8Array, block: Uint8Array): Buffer {
  assertAesKey(key);
  if (block.length !== AES_BLOCK) throw new RangeError("block must be 16 bytes");
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

/** AES-128-CBC decrypt with no padding removal. `data` must be a whole number of blocks. */
export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Buffer {
  assertAesKey(key);
  if (iv.length !== AES_BLOCK) throw new RangeError("iv must be 16 bytes");
  if (data.length === 0 || data.length % AES_BLOCK !== 0) throw new RangeError("data must be whole AES blocks");
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** GF(2^128) doubling used to derive the CMAC subkeys (SP 800-38B, section 6.1). */
function dbl(block: Buffer): Buffer {
  const out = Buffer.alloc(AES_BLOCK);
  for (let i = 0; i < AES_BLOCK; i++) {
    out[i] = ((block[i] << 1) | (i + 1 < AES_BLOCK ? block[i + 1] >>> 7 : 0)) & 0xff;
  }
  if (block[0] & 0x80) out[AES_BLOCK - 1] ^= 0x87;
  return out;
}

export function cmacSubkeys(key: Uint8Array): { k1: Buffer; k2: Buffer } {
  const l = aesEncryptBlock(key, Buffer.alloc(AES_BLOCK));
  const k1 = dbl(l);
  return { k1, k2: dbl(k1) };
}

/** AES-128 CMAC (NIST SP 800-38B / RFC 4493). Returns the full 16-byte tag. */
export function aesCmac(key: Uint8Array, message: Uint8Array): Buffer {
  const { k1, k2 } = cmacSubkeys(key);
  const blocks = Math.max(1, Math.ceil(message.length / AES_BLOCK));
  const complete = message.length > 0 && message.length % AES_BLOCK === 0;

  const last = Buffer.alloc(AES_BLOCK);
  const tail = message.subarray((blocks - 1) * AES_BLOCK);
  last.set(tail);
  if (!complete) last[tail.length] = 0x80;
  const subkey = complete ? k1 : k2;
  for (let i = 0; i < AES_BLOCK; i++) last[i] ^= subkey[i];

  let x: Buffer = Buffer.alloc(AES_BLOCK);
  for (let b = 0; b < blocks - 1; b++) {
    const y = Buffer.alloc(AES_BLOCK);
    for (let i = 0; i < AES_BLOCK; i++) y[i] = x[i] ^ message[b * AES_BLOCK + i];
    x = aesEncryptBlock(key, y);
  }
  for (let i = 0; i < AES_BLOCK; i++) last[i] ^= x[i];
  return aesEncryptBlock(key, last);
}

/**
 * NXP MAC truncation (AN12196 / NTAG 424 DNA datasheet): keep the bytes at odd positions
 * (S14 || S12 || ... || S0 in NXP's MSB-first numbering = indices 1, 3, ..., 15 here).
 */
export function truncateMac(fullMac: Uint8Array): Buffer {
  if (fullMac.length !== AES_BLOCK) throw new RangeError("MAC must be 16 bytes");
  const out = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) out[i] = fullMac[2 * i + 1];
  return out;
}
