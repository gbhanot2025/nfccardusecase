import "server-only";
import { desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { profiles, scanEvents, tags, user } from "@/lib/db/schema";
import { PROFILE_TYPE_INFO, type ProfileType } from "@/profile-types/registry";
import { hit } from "./rate-limit";

/** At most one alert email per tag in this window, and at most ALERTS_PER_DAY a day; every scan is recorded. */
export const SCAN_ALERT_WINDOW_SECONDS = 15 * 60;
export const ALERTS_PER_DAY = 10;

/** Link previews, crawlers and scanners aren't people scanning a tag: don't record or alert. */
export function isBot(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl|wget|python-requests|headless|lighthouse/i.test(
    userAgent,
  );
}
/** The same visitor reloading a QR page isn't a new scan. */
const QR_DEDUPE_SECONDS = 10 * 60;

/** Network prefix only (IPv4 /24, IPv6 /48): enough to spot repeats, not enough to identify someone. */
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) {
    const groups = ip.split("::")[0].split(":").filter(Boolean).slice(0, 3);
    while (groups.length < 3) groups.push("0");
    return `${groups.join(":")}::/48`;
  }
  return null;
}

/** Coarse device description from the user agent, e.g. "iPhone · Safari". Never stores the raw string. */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.slice(0, 500);
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Other device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : null;
  return browser ? `${device} · ${browser}` : device;
}

export type ScanAlert = { to: string; itemLabel: string; source: "nfc" | "qr"; device: string | null; at: Date };

const SHORT_LABEL: Record<ProfileType, string> = {
  business_card: "business card",
  lost_pet: "pet",
  lost_device: "device",
  lost_id: "wallet or ID",
};

/**
 * Record a scan of an active tag by someone other than its owner. Verified NFC taps are always new;
 * QR visits from the same network within 10 minutes count once. Returns the alert to email, if any:
 * only for lost-item profiles with alerts on, at most one per tag every 15 minutes.
 */
export async function recordScan(
  db: Database,
  opts: { tagId: string; source: "nfc" | "qr"; ip: string | null; userAgent: string | null },
): Promise<ScanAlert | null> {
  if (opts.source === "qr" && isBot(opts.userAgent)) return null;
  const prefix = ipPrefix(opts.ip);
  if (opts.source === "qr") {
    const seen = await hit(db, `scan:qr:${opts.tagId}:${prefix ?? "unknown"}`, {
      limit: 1,
      windowSeconds: QR_DEDUPE_SECONDS,
    });
    if (!seen.allowed) return null;
  }

  const [row] = await db
    .select({
      status: tags.status,
      profileId: profiles.id,
      type: profiles.type,
      scanAlerts: profiles.scanAlerts,
      ownerEmail: user.email,
    })
    .from(tags)
    .innerJoin(profiles, eq(profiles.tagId, tags.id))
    .innerJoin(user, eq(user.id, tags.ownerId))
    .where(eq(tags.id, opts.tagId));
  if (!row || row.status !== "active") return null;

  const device = describeDevice(opts.userAgent);
  const [scan] = await db
    .insert(scanEvents)
    .values({ tagId: opts.tagId, profileId: row.profileId, source: opts.source, ipPrefix: prefix, deviceInfo: device })
    .returning({ createdAt: scanEvents.createdAt });

  if (!PROFILE_TYPE_INFO[row.type].lostItem || !row.scanAlerts) return null;
  const alert = await hit(db, `scanalert:${opts.tagId}`, { limit: 1, windowSeconds: SCAN_ALERT_WINDOW_SECONDS });
  if (!alert.allowed) return null;
  const daily = await hit(db, `scanalert:day:${opts.tagId}`, { limit: ALERTS_PER_DAY, windowSeconds: 24 * 60 * 60 });
  if (!daily.allowed) return null;
  return { to: row.ownerEmail, itemLabel: SHORT_LABEL[row.type], source: opts.source, device, at: scan.createdAt };
}

export async function listScansForProfile(db: Database, profileId: string, limit = 20) {
  return db
    .select({
      id: scanEvents.id,
      source: scanEvents.source,
      deviceInfo: scanEvents.deviceInfo,
      createdAt: scanEvents.createdAt,
    })
    .from(scanEvents)
    .where(eq(scanEvents.profileId, profileId))
    .orderBy(desc(scanEvents.createdAt))
    .limit(limit);
}
