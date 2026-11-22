import "dotenv/config";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { type AltchaChallenge, createChallenge, verifySolution } from "@/server/altcha";
import { createBatch } from "@/server/batches";
import { listMessagesForProfile, RELAY_LIMITS, submitFinderMessage } from "@/server/relay";
import { adminDisableTag, claimTag } from "@/server/tags";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle({ client: pool, schema }) : undefined;

/** What the finder's browser does: find the number, encode the payload. */
function solve(c: AltchaChallenge, tamper: Partial<{ number: number; signature: string }> = {}): string {
  for (let n = 0; n <= c.maxnumber; n++) {
    if (
      createHash("sha256")
        .update(c.salt + n)
        .digest("hex") === c.challenge
    ) {
      const payload = {
        algorithm: c.algorithm,
        challenge: c.challenge,
        number: n,
        salt: c.salt,
        signature: c.signature,
        ...tamper,
      };
      return Buffer.from(JSON.stringify(payload)).toString("base64");
    }
  }
  throw new Error("unsolvable");
}

describe.skipIf(!db)("finder relay", () => {
  const d = db!;
  let petCode: string;
  let cardCode: string;
  let petTagId: string;

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
    petCode = batch.tags[0].publicCode;
    petTagId = batch.tags[0].tagId;
    cardCode = batch.tags[1].publicCode;
  });

  afterAll(async () => {
    await pool?.end();
  });

  const send = (publicCode: string, raw: Record<string, unknown>, ip: string | null = "198.51.100.7") =>
    submitFinderMessage(d, { publicCode, ip, raw: { altcha: solve(createChallenge()), ...raw } });

  it("relays a message with location to the owner without exposing them to the finder", async () => {
    const result = await send(petCode, {
      message: "Found your dog <b>near</b> the park",
      contact: "555-0100",
      latitude: "51.5007292",
      longitude: "-0.1246254",
    });
    expect(result).toMatchObject({
      ok: true,
      email: {
        to: "alice@example.com",
        itemLabel: "pet",
        finderContact: "555-0100",
        location: { latitude: 51.50073, longitude: -0.12463 },
      },
    });
    const [profile] = await d.select().from(schema.profiles).where(eq(schema.profiles.tagId, petTagId));
    const saved = await listMessagesForProfile(d, profile.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ body: "Found your dog <b>near</b> the park", latitude: 51.50073 });
  });

  it("only lost-item tags that are active can receive messages", async () => {
    expect(await send(cardCode, { message: "hi" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await send("ZZZZZZZZZZ", { message: "hi" })).toMatchObject({ ok: false, error: "not_found" });
    await adminDisableTag(d, "admin", petTagId);
    expect(await send(petCode, { message: "hi" })).toMatchObject({ ok: false, error: "not_found" });
  });

  it("validates input", async () => {
    expect(await send(petCode, { message: "   " })).toMatchObject({ ok: false, error: "invalid" });
    expect(await send(petCode, { message: "x".repeat(2001) })).toMatchObject({ ok: false, error: "invalid" });
    expect(await send(petCode, { message: "hi", latitude: "51.5" })).toMatchObject({ ok: false, error: "invalid" });
    expect(await send(petCode, { message: "hi", latitude: "91", longitude: "0" })).toMatchObject({
      ok: false,
      error: "invalid",
    });
  });

  it("needs a valid, unused, unexpired proof of work", async () => {
    const c = createChallenge();
    const good = solve(c);
    const raw = { message: "hi" };
    expect(await submitFinderMessage(d, { publicCode: petCode, ip: null, raw: { ...raw, altcha: "" } })).toMatchObject({
      error: "bot_check",
    });
    expect(
      await submitFinderMessage(d, { publicCode: petCode, ip: null, raw: { ...raw, altcha: solve(c, { number: 0 }) } }),
    ).toMatchObject({ error: "bot_check" });
    expect(
      await submitFinderMessage(d, {
        publicCode: petCode,
        ip: null,
        raw: { ...raw, altcha: solve(c, { signature: "0".repeat(64) }) },
      }),
    ).toMatchObject({ error: "bot_check" });
    expect(
      await submitFinderMessage(d, { publicCode: petCode, ip: null, raw: { ...raw, altcha: good } }),
    ).toMatchObject({ ok: true });
    expect(
      await submitFinderMessage(d, { publicCode: petCode, ip: null, raw: { ...raw, altcha: good } }),
    ).toMatchObject({ error: "bot_check" });

    const old = createChallenge(Date.now() - 31 * 60 * 1000);
    expect(await verifySolution(d, solve(old))).toBe(false);
  });

  it("limits each sender, but one sender can't stop others from reaching the owner", async () => {
    for (let i = 0; i < RELAY_LIMITS.perTagPerSender.limit; i++) {
      expect((await send(petCode, { message: `m${i}` })).ok).toBe(true);
    }
    for (let i = 0; i < 20; i++) {
      expect(await send(petCode, { message: "spam" })).toMatchObject({ ok: false, error: "rate_limited" });
    }
    expect((await send(petCode, { message: "a real finder" }, "198.51.100.8")).ok).toBe(true);
  });

  it("limits a sender by IP, with IPv6 counted per /64", async () => {
    // Different addresses in one /64 are one sender: the per-tag cap applies to all of them together.
    for (let i = 1; i <= RELAY_LIMITS.perTagPerSender.limit; i++) {
      expect((await send(petCode, { message: `m${i}` }, `2001:db8:1:2::${i}`)).ok).toBe(true);
    }
    expect(await send(petCode, { message: "x" }, "2001:db8:1:2::99")).toMatchObject({
      ok: false,
      error: "rate_limited",
    });
    expect((await send(petCode, { message: "other network" }, "2001:db8:1:3::1")).ok).toBe(true);
  });

  it("over the daily email cap the message is saved but not emailed", async () => {
    await pool!.query("INSERT INTO app_rate_limits (key, count, reset_at) VALUES ($1, $2, now() + interval '1 day')", [
      `relay:email:${petTagId}`,
      RELAY_LIMITS.emailsPerTag.limit,
    ]);
    const result = await send(petCode, { message: "still saved" });
    expect(result).toMatchObject({ ok: true, email: null });
    const [profile] = await d.select().from(schema.profiles).where(eq(schema.profiles.tagId, petTagId));
    expect((await listMessagesForProfile(d, profile.id))[0].body).toBe("still saved");
  });
});
