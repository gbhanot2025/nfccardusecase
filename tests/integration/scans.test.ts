import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createBatch } from "@/server/batches";
import { setScanAlerts } from "@/server/profiles";
import { listScansForProfile, recordScan } from "@/server/scans";
import { adminDisableTag, claimTag } from "@/server/tags";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle({ client: pool, schema }) : undefined;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1";

describe.skipIf(!db)("scans and alerts", () => {
  const d = db!;
  let pet: string;
  let card: string;

  beforeEach(async () => {
    await pool!.query('TRUNCATE "user", tags, tag_batches, audit_log, app_rate_limits CASCADE');
    await d.insert(schema.user).values([
      { id: "admin", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "alice", name: "Alice", email: "alice@example.com" },
    ]);
    const batch = await createBatch(
      d,
      { label: "B", formFactor: "card", allowedTypes: ["business_card", "lost_pet"], quantity: 2 },
      "admin",
    );
    for (const [i, type] of (["lost_pet", "business_card"] as const).entries()) {
      await claimTag(d, {
        tagId: batch.tags[i].tagId,
        userId: "alice",
        ip: null,
        limitByIp: false,
        input: { mode: "new", claimCode: batch.tags[i].claimCode, type },
      });
    }
    [pet, card] = batch.tags.map((t) => t.tagId);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const scan = (tagId: string, source: "nfc" | "qr", ip = "203.0.113.5") =>
    recordScan(d, { tagId, source, ip, userAgent: UA });

  async function scansOf(tagId: string) {
    const [p] = await d.select().from(schema.profiles).where(eq(schema.profiles.tagId, tagId));
    return listScansForProfile(d, p.id);
  }

  it("records scans with only a network prefix and a coarse device, and alerts once per window", async () => {
    const first = await scan(pet, "nfc");
    expect(first).toMatchObject({
      to: "alice@example.com",
      itemLabel: "pet",
      source: "nfc",
      device: "iPhone · Safari",
    });
    expect(await scan(pet, "nfc")).toBeNull(); // recorded, but no second email within 15 minutes
    const rows = await d.select().from(schema.scanEvents);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ipPrefix: "203.0.113.0/24", deviceInfo: "iPhone · Safari" });
    expect(JSON.stringify(rows)).not.toContain("203.0.113.5");

    await pool!.query("UPDATE app_rate_limits SET reset_at = now() - interval '1 second' WHERE key LIKE 'scanalert:%'");
    expect(await scan(pet, "nfc")).not.toBeNull();
  });

  it("counts repeated QR visits from the same network once", async () => {
    await scan(pet, "qr");
    await scan(pet, "qr");
    await scan(pet, "qr", "198.51.100.9");
    expect(await scansOf(pet)).toHaveLength(2);
  });

  it("records business card scans without alerting, and respects alerts off", async () => {
    expect(await scan(card, "qr")).toBeNull();
    expect(await scansOf(card)).toHaveLength(1);
    await setScanAlerts(d, "alice", pet, false);
    expect(await scan(pet, "nfc")).toBeNull();
    expect(await scansOf(pet)).toHaveLength(1);
  });

  it("ignores tags that aren't active", async () => {
    await adminDisableTag(d, "admin", pet);
    expect(await scan(pet, "nfc")).toBeNull();
    expect(await d.select().from(schema.scanEvents)).toHaveLength(0);
  });
});
