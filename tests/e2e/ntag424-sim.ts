import { createCipheriv, randomBytes } from "node:crypto";

/**
 * A tiny, independent NTAG 424 DNA simulator for browser tests: produces the ?picc=&cmac= a real tag would
 * write for a UID and counter. Written from AN12196/AN10922 and the key layout in src/server/ntag424/README.md,
 * without importing the server code, so the e2e test also cross-checks the server implementation.
 */
const SYSTEM_ID = Buffer.from("TagPlatformNTAG424v1", "ascii");

function aesEcb(key: Buffer, block: Buffer): Buffer {
  const c = createCipheriv("aes-128-ecb", key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}

function shiftLeft(b: Buffer): Buffer {
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = ((b[i] << 1) | (i < 15 ? b[i + 1] >> 7 : 0)) & 0xff;
  if (b[0] & 0x80) out[15] ^= 0x87;
  return out;
}

/** AES-CMAC (NIST SP 800-38B). */
function cmac(key: Buffer, msg: Buffer): Buffer {
  const k1 = shiftLeft(aesEcb(key, Buffer.alloc(16)));
  const k2 = shiftLeft(k1);
  const n = Math.max(1, Math.ceil(msg.length / 16));
  const complete = msg.length > 0 && msg.length % 16 === 0;
  const last = Buffer.alloc(16);
  msg.subarray((n - 1) * 16).copy(last);
  if (!complete) last[msg.length - (n - 1) * 16] = 0x80;
  const sub = complete ? k1 : k2;
  for (let i = 0; i < 16; i++) last[i] ^= sub[i];
  let x: Buffer = Buffer.alloc(16);
  for (let b = 0; b < n - 1; b++) {
    const block = msg.subarray(b * 16, b * 16 + 16);
    x = aesEcb(key, Buffer.from(x.map((v, i) => v ^ block[i])));
  }
  return aesEcb(key, Buffer.from(x.map((v, i) => v ^ last[i])));
}

const diversify = (master: Buffer, m: Buffer) => cmac(master, Buffer.concat([Buffer.from([0x01]), m]));

export function simulateTap(masterKeyHex: string, uidHex: string, counter: number): { picc: string; cmac: string } {
  const master = Buffer.from(masterKeyHex, "hex");
  const uid = Buffer.from(uidHex, "hex");
  const metaReadKey = diversify(master, Buffer.concat([Buffer.from([0x53, 2]), SYSTEM_ID]));
  const fileReadKey = diversify(master, Buffer.concat([Buffer.from([0x54]), uid, Buffer.from([1]), SYSTEM_ID]));

  const ctr = Buffer.from([counter & 0xff, (counter >> 8) & 0xff, (counter >> 16) & 0xff]);
  const plain = Buffer.concat([Buffer.from([0xc7]), uid, ctr, randomBytes(5)]);
  const enc = createCipheriv("aes-128-cbc", metaReadKey, Buffer.alloc(16));
  enc.setAutoPadding(false);
  const picc = Buffer.concat([enc.update(plain), enc.final()]);

  const sv2 = Buffer.concat([Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]), uid, ctr]);
  const full = cmac(cmac(fileReadKey, sv2), Buffer.alloc(0));
  const mac = Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => full[i]));
  return { picc: picc.toString("hex").toUpperCase(), cmac: mac.toString("hex").toUpperCase() };
}

export function randomUid(): string {
  return "04" + randomBytes(6).toString("hex").toUpperCase();
}
