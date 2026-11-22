import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { acceptTapCounter } from "@/server/ntag424/counter";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle({ client: pool, schema }) : undefined;

describe.skipIf(!db)("NTAG 424 tap counter (replay protection)", () => {
  const d = db!;
  const lastCounter = async () =>
    (await d.select({ c: schema.tags.lastCounter }).from(schema.tags).where(eq(schema.tags.id, "tag_ctr")))[0].c;

  beforeEach(async () => {
    await pool!.query("TRUNCATE tags CASCADE");
    await d.insert(schema.tags).values({
      id: "tag_ctr",
      publicCode: "CTR00001",
      claimCodeHash: "hash",
      formFactor: "card",
      allowedTypes: ["business_card"],
      lastCounter: 5,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("accepts a newer counter and stores it", async () => {
    expect(await acceptTapCounter(d, "tag_ctr", 6)).toBe(true);
    expect(await lastCounter()).toBe(6);
  });

  it("rejects a replayed or older counter", async () => {
    expect(await acceptTapCounter(d, "tag_ctr", 5)).toBe(false);
    expect(await acceptTapCounter(d, "tag_ctr", 4)).toBe(false);
    expect(await lastCounter()).toBe(5);
  });

  it("lets only one of many concurrent identical taps through", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => acceptTapCounter(d, "tag_ctr", 9)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await lastCounter()).toBe(9);
  });

  it("rejects unknown tags and out-of-range counters", async () => {
    expect(await acceptTapCounter(d, "nope", 100)).toBe(false);
    expect(await acceptTapCounter(d, "tag_ctr", 0x1000000)).toBe(false);
    expect(await acceptTapCounter(d, "tag_ctr", 6.5)).toBe(false);
    expect(await lastCounter()).toBe(5);
  });
});
