import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { scanAlertEmail, sendEmail } from "@/lib/email";
import { clientIp } from "./request";
import { recordScan } from "./scans";

/**
 * Record a visitor's scan and send the owner's alert after the page has been sent, so the visitor
 * never waits on the database or email. Call during render (request headers are read here, not later).
 */
export async function recordScanAfterResponse(tagId: string, source: "nfc" | "qr"): Promise<void> {
  const ip = await clientIp();
  const userAgent = (await headers()).get("user-agent");
  after(async () => {
    try {
      const alert = await recordScan(getDb(), { tagId, source, ip, userAgent });
      if (alert) await sendEmail(scanAlertEmail({ ...alert, dashboardUrl: `${env().APP_BASE_URL}/dashboard` }));
    } catch {
      console.error("Could not record a scan or send its alert");
    }
  });
}
