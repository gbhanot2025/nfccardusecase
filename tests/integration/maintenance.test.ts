import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createBatch } from "@/server/batches";
import { runMaintenance } from "@/server/maintenance";
import { hit } from "@/server/rate-limit";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle({ client: pool, schema }) : undefined;

describe.skipIf(!db)("maintenance", () => {
  const d = db!;

  beforeEach(async () => {
    await pool!.query('TRUNCATE "user", tags, tag_batches, audit_log, app_rate_limits CASCADE');
    await d.insert(schema.user).values({ id: "admin", name: "Admin", email: "admin@example.com", role: "admin" });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("deletes personal data past the retention period and expired limits, at most hourly", async () => {
    const { tags } = await createBatch(
      d,
      { label: "B", formFactor: "card", allowedTypes: ["lost_pet"], quantity: 1 },
      "admin",
    );
    const tagId = tags[0].tagId;
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await d.insert(schema.messages).values([
      { tagId, body: "old", createdAt: old },
      { tagId, body: "recent" },
    ]);
    await d.insert(schema.scanEvents).values([
      { tagId, source: "qr", createdAt: old },
      { tagId, source: "qr" },
    ]);
    await hit(d, "stale", { limit: 1, windowSeconds: 60 });
    await pool!.query("UPDATE app_rate_limits SET reset_at = now() - interval '1 minute' WHERE key = 'stale'");

    expect(await runMaintenance(d)).toBe(true);
    expect((await d.select().from(schema.messages)).map((m) => m.body)).toEqual(["recent"]);
    expect(await d.select().from(schema.scanEvents)).toHaveLength(1);
    const keys = (await d.select().from(schema.rateLimits)).map((r) => r.key);
    expect(keys).not.toContain("stale");
    expect(await runMaintenance(d)).toBe(false);
  });
});
