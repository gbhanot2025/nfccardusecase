import "server-only";
import { BlockList, isIP } from "node:net";
import { headers } from "next/headers";
import { env } from "@/lib/env";

/**
 * Pick the client address from X-Forwarded-For. Walks from the right (entries appended by our own proxies)
 * and skips addresses in TRUSTED_PROXIES; the first one left is the client. With no trusted proxies
 * configured, the last entry is used: in production Caddy is the only way in and replaces whatever the
 * client sent (the app port is never published, see docker-compose.prod.yml).
 */
export function pickClientIp(forwardedFor: string | null, trustedProxies: readonly string[]): string | null {
  if (!forwardedFor) return null;
  const entries = forwardedFor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(-20);
  const trusted = new BlockList();
  for (const entry of trustedProxies) {
    const [addr, bits] = entry.split("/");
    const type = isIP(addr) === 6 ? "ipv6" : "ipv4";
    if (!isIP(addr)) continue;
    if (bits) trusted.addSubnet(addr, Number(bits), type);
    else trusted.addAddress(addr, type);
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const ip = entries[i].replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
    const family = isIP(ip);
    if (!family) return null; // malformed: don't trust anything further left
    if (!trusted.check(ip, family === 6 ? "ipv6" : "ipv4")) return ip;
  }
  return null;
}

/**
 * Client IP for rate limiting, or "unknown". Never null, so a missing or malformed header can't switch the
 * per-IP limits off: such requests share one bucket.
 */
export async function clientIp(): Promise<string> {
  return pickClientIp((await headers()).get("x-forwarded-for"), env().TRUSTED_PROXIES) ?? "unknown";
}

/** Rate-limit key for an address: IPv6 by /64 (one subscriber's network), IPv4 as is. */
export function ipRateKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const full = expandIpv6(ip);
  return full ? `${full.slice(0, 4).join(":")}::/64` : ip;
}

function expandIpv6(ip: string): string[] | null {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  if (ip.includes(".")) return null;
  const missing = 8 - h.length - t.length;
  if (missing < 0 || (tail === undefined && missing !== 0)) return null;
  return [...h, ...Array(missing).fill("0"), ...t].map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""));
}
