import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle({ client: pool, schema }) : undefined;

/** Drizzle wraps driver errors; the Postgres constraint name is on the cause. */
async function constraintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    const e = err as { constraint?: string; cause?: { constraint?: string } };
    return e.cause?.constraint ?? e.constraint;
  }
}

describe.skipIf(!db)("database rules", () => {
  const d = db!;

  beforeEach(async () => {
    await pool!.query('TRUNCATE "user", tags, audit_log CASCADE');
    await d.insert(schema.user).values({ id: "u1", name: "Owner", email: "owner@example.com" });
    await d.insert(schema.tags).values({
      id: "tag_1",
      publicCode: "AB7K9QXM",
      claimCodeHash: "hash",
      formFactor: "card",
      allowedTypes: ["business_card"],
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("new tags start unclaimed with counter 0", async () => {
    const [tag] = await d.select().from(schema.tags).where(eq(schema.tags.id, "tag_1"));
    expect(tag.status).toBe("unclaimed");
    expect(tag.lastCounter).toBe(0);
    expect(tag.ownerId).toBeNull();
  });

  it("an active tag must have an owner", async () => {
    expect(await constraintOf(d.update(schema.tags).set({ status: "active" }).where(eq(schema.tags.id, "tag_1")))).toBe(
      "tags_active_has_owner",
    );
    await d.update(schema.tags).set({ status: "active", ownerId: "u1" }).where(eq(schema.tags.id, "tag_1"));
  });

  it("public codes are unique", async () => {
    const dup = d.insert(schema.tags).values({
      id: "tag_2",
      publicCode: "AB7K9QXM",
      claimCodeHash: "hash",
      formFactor: "card",
      allowedTypes: ["business_card"],
    });
    expect(await constraintOf(dup)).toBe("tags_public_code_unique");
  });

  it("a tag needs at least one allowed profile type", async () => {
    const empty = d.insert(schema.tags).values({
      id: "tag_3",
      publicCode: "ZZZZZZZZ",
      claimCodeHash: "hash",
      formFactor: "sticker",
      allowedTypes: [],
    });
    expect(await constraintOf(empty)).toBe("tags_allowed_types_not_empty");
  });

  it("allows only one profile per tag", async () => {
    await d.insert(schema.profiles).values({ tagId: "tag_1", type: "business_card" });
    expect(await constraintOf(d.insert(schema.profiles).values({ tagId: "tag_1", type: "lost_pet" }))).toBe(
      "profiles_tag_id_unique",
    );
  });

  it("lost mode is only for lost-item profile types", async () => {
    expect(
      await constraintOf(d.insert(schema.profiles).values({ tagId: "tag_1", type: "business_card", lostMode: true })),
    ).toBe("profiles_lost_mode_only_lost_types");
  });

  it("finder messages must be 1–2000 characters", async () => {
    expect(await constraintOf(d.insert(schema.messages).values({ tagId: "tag_1", body: "" }))).toBe(
      "messages_body_length",
    );
    expect(await constraintOf(d.insert(schema.messages).values({ tagId: "tag_1", body: "x".repeat(2001) }))).toBe(
      "messages_body_length",
    );
  });

  it("deleting a user frees their tags instead of deleting them", async () => {
    await d.update(schema.tags).set({ status: "disabled", ownerId: "u1" }).where(eq(schema.tags.id, "tag_1"));
    await d.delete(schema.user).where(eq(schema.user.id, "u1"));
    const [tag] = await d.select().from(schema.tags).where(eq(schema.tags.id, "tag_1"));
    expect(tag.ownerId).toBeNull();
  });
});
