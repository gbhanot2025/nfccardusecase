import "server-only";
import { headers } from "next/headers";

/**
 * Client IP for rate limiting. In production Caddy is the only way in and sets X-Forwarded-For,
 * replacing anything the client sent, so the last entry is the real client address.
 * Returns null when there's no proxy (local development).
 */
export async function clientIp(): Promise<string | null> {
  const forwarded = (await headers()).get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last && last.length <= 64 ? last : null;
}
