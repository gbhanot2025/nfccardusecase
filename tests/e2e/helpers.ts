import { createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const OUTBOX = ".mail-outbox-e2e";

/** Wait for the newest email to an address and return the first link in it. */
export async function latestLinkTo(to: string, subject: RegExp, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = (await readdir(OUTBOX).catch(() => [])).sort().reverse();
    for (const file of files) {
      const mail = JSON.parse(await readFile(path.join(OUTBOX, file), "utf8"));
      if (mail.to === to && subject.test(mail.subject)) {
        const match = String(mail.text).match(/https?:\/\/\S+/);
        if (match) return match[0];
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${to} matching ${subject}`);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) so tests can act like an authenticator app. */
export function totp(base32Secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}
