import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { env } from "@/lib/env";
import { hit } from "./rate-limit";

/**
 * ALTCHA-style proof of work (https://altcha.org protocol, implemented here without the widget so the
 * page stays CSP-clean): the server issues a signed challenge, the finder's browser finds the number
 * whose SHA-256(salt + number) equals it, and the server checks the signature, expiry and that each
 * challenge is used once. Bots must spend CPU per message; people see nothing.
 */
export const ALTCHA_MAX_NUMBER = 50_000;
const EXPIRES_SECONDS = 30 * 60;

export type AltchaChallenge = {
  algorithm: "SHA-256";
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
};

/** HMAC key derived from the app secret, so there's no extra secret to manage. */
function hmacKey(): Buffer {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update("altcha-v1").digest();
}

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");
const sign = (challenge: string) => createHmac("sha256", hmacKey()).update(challenge).digest("hex");

export function createChallenge(now = Date.now()): AltchaChallenge {
  const expires = Math.floor(now / 1000) + EXPIRES_SECONDS;
  const salt = `${randomBytes(12).toString("hex")}?expires=${expires}`;
  const challenge = sha256Hex(salt + randomInt(ALTCHA_MAX_NUMBER + 1));
  return { algorithm: "SHA-256", challenge, maxnumber: ALTCHA_MAX_NUMBER, salt, signature: sign(challenge) };
}

const payloadSchema = z.object({
  algorithm: z.literal("SHA-256"),
  challenge: z.string().regex(/^[0-9a-f]{64}$/),
  number: z.number().int().min(0).max(ALTCHA_MAX_NUMBER),
  salt: z.string().regex(/^[0-9a-f]{24}\?expires=\d{10}$/),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

/** The browser's answer: base64 of the JSON payload, as the ALTCHA widget sends it. */
export async function verifySolution(db: Database, payloadB64: unknown, now = Date.now()): Promise<boolean> {
  if (typeof payloadB64 !== "string" || payloadB64.length > 1000) return false;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
  } catch {
    return false;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return false;
  const p = parsed.data;

  const expires = Number(p.salt.split("?expires=")[1]);
  if (expires * 1000 <= now) return false;
  const expected = Buffer.from(sign(p.challenge), "hex");
  if (!timingSafeEqual(expected, Buffer.from(p.signature, "hex"))) return false;
  if (sha256Hex(p.salt + p.number) !== p.challenge) return false;

  // One use per challenge: the second submission of the same solution is refused until it expires anyway.
  const once = await hit(db, `altcha:${p.challenge}`, { limit: 1, windowSeconds: EXPIRES_SECONDS });
  return once.allowed;
}
