import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createBatch, getBatch, listBatches, reissueClaimCodes } from "@/server/batches";
import { TAG_ID_PATTERN, PUBLIC_CODE_PATTERN } from "@/server/codes";
import { hit } from "@/server/rate-limit";
import {
  adminDisableTag,
  adminEnableTag,
  CLAIM_LIMITS,
  claimByPublicCode,
  claimTag,
  disableOwnTag,
  enableOwnTag,
  findTagById,
  findTagByPublicCode,
  listOwnedTags,
} from "@/server/tags";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle({ client: pool, schema }) : undefined;

describe.skipIf(!db)("tag batches and claiming", () => {
  const d = db!;

  beforeEach(async () => {
    await pool!.query('TRUNCATE "user", tags, tag_batches, audit_log, app_rate_limits CASCADE');
    await d.insert(schema.user).values([
      { id: "admin", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function newBatch(
    quantity = 2,
    allowedTypes: ("business_card" | "lost_pet")[] = ["business_card", "lost_pet"],
  ) {
    return createBatch(d, { label: "Test batch", formFactor: "card", allowedTypes, quantity }, "admin");
  }

  const claim = (tagId: string, userId: string, claimCode: string, type: "business_card" | "lost_pet" = "lost_pet") =>
    claimTag(d, { tagId, userId, ip: "203.0.113.9", limitByIp: true, input: { mode: "new", claimCode, type } });

  it("creates random, well-formed codes and stores only a hash of each claim code", async () => {
    const batch = await newBatch(3);
    expect(batch.tags).toHaveLength(3);
    for (const t of batch.tags) {
      expect(t.tagId).toMatch(TAG_ID_PATTERN);
      expect(t.publicCode).toMatch(PUBLIC_CODE_PATTERN);
      expect(t.claimCode).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    }
    const rows = await d.select().from(schema.tags);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.claimCodeHash).toMatch(/^\$argon2id\$/);
      for (const t of batch.tags) expect(row.claimCodeHash).not.toContain(t.claimCode.replace("-", ""));
      expect(row.status).toBe("unclaimed");
    }
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it("records the batch with counts and an audit entry without codes", async () => {
    const batch = await newBatch(2);
    const [listed] = await listBatches(d);
    expect(listed).toMatchObject({ id: batch.batchId, quantity: 2, claimed: 0 });
    const audit = await d.select().from(schema.auditLog);
    expect(audit.map((a) => a.action)).toContain("batch.created");
    expect(JSON.stringify(audit)).not.toContain(batch.tags[0].claimCode.slice(0, 5));
  });

  it("claims a tag with the right code (typed loosely) and creates its profile", async () => {
    const { tags } = await newBatch(1);
    const loose = tags[0].claimCode.toLowerCase().replace("-", " ");
    expect(await claim(tags[0].tagId, "alice", loose)).toEqual({ ok: true });

    const found = await findTagById(d, tags[0].tagId);
    expect(found?.tag).toMatchObject({ status: "active", ownerId: "alice" });
    expect(found?.profile).toMatchObject({ type: "lost_pet", data: {} });
    expect((await findTagByPublicCode(d, tags[0].publicCode.toLowerCase()))?.tag.id).toBe(tags[0].tagId);
  });

  it("rejects a wrong code, a second claim, and a type the tag doesn't allow", async () => {
    const { tags } = await newBatch(2, ["business_card"]);
    expect(await claim(tags[0].tagId, "alice", "AAAAA-AAAAA", "business_card")).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await claim(tags[0].tagId, "alice", "not a code", "business_card")).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await claim(tags[0].tagId, "alice", tags[0].claimCode, "lost_pet")).toEqual({
      ok: false,
      error: "type_not_allowed",
    });
    expect(await claim(tags[0].tagId, "alice", tags[0].claimCode, "business_card")).toEqual({ ok: true });
    expect(await claim(tags[0].tagId, "bob", tags[0].claimCode, "business_card")).toEqual({
      ok: false,
      error: "not_claimable",
    });
    // Another tag's code doesn't work on this one.
    expect(await claim(tags[1].tagId, "bob", tags[0].claimCode, "business_card")).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });

  it("only one of two simultaneous claims wins", async () => {
    const { tags } = await newBatch(1);
    const results = await Promise.all([
      claim(tags[0].tagId, "alice", tags[0].claimCode),
      claim(tags[0].tagId, "bob", tags[0].claimCode),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await d.select().from(schema.profiles)).toHaveLength(1);
  });

  it("locks a tag for a user after too many attempts, even with the right code", async () => {
    const { tags } = await newBatch(1);
    for (let i = 0; i < CLAIM_LIMITS.perTagPerUser.limit; i++) {
      expect((await claim(tags[0].tagId, "bob", "AAAAA-AAAAA")).ok).toBe(false);
    }
    expect(await claim(tags[0].tagId, "bob", tags[0].claimCode)).toEqual({ ok: false, error: "rate_limited" });
  });

  it("someone guessing can't lock the tag for its real buyer", async () => {
    const { tags } = await newBatch(1);
    for (let i = 0; i < 15; i++) await claim(tags[0].tagId, "bob", "AAAAA-AAAAA");
    expect(await claim(tags[0].tagId, "alice", tags[0].claimCode)).toEqual({ ok: true });
  });

  it("a profile on a tag an admin disabled can't be moved to another tag", async () => {
    const { tags } = await newBatch(2);
    await claim(tags[0].tagId, "alice", tags[0].claimCode);
    await adminDisableTag(d, "admin", tags[0].tagId);
    const moved = await claimTag(d, {
      tagId: tags[1].tagId,
      userId: "alice",
      ip: null,
      limitByIp: false,
      input: { mode: "move", claimCode: tags[1].claimCode, fromTagId: tags[0].tagId },
    });
    expect(moved).toEqual({ ok: false, error: "move_not_allowed" });
    expect((await findTagById(d, tags[0].tagId))?.tag.disabledReason).toBe("admin");
  });

  it("moving off a tag the owner turned off keeps it 'turned off by owner'", async () => {
    const { tags } = await newBatch(2);
    await claim(tags[0].tagId, "alice", tags[0].claimCode);
    await disableOwnTag(d, "alice", tags[0].tagId);
    const moved = await claimTag(d, {
      tagId: tags[1].tagId,
      userId: "alice",
      ip: null,
      limitByIp: false,
      input: { mode: "move", claimCode: tags[1].claimCode, fromTagId: tags[0].tagId },
    });
    expect(moved).toEqual({ ok: true });
    expect((await findTagById(d, tags[0].tagId))?.tag.disabledReason).toBe("owner");
    // With its profile gone, it can't be turned back on.
    expect(await enableOwnTag(d, "alice", tags[0].tagId)).toBe(false);
  });

  it("rate-limit windows count hits and reset", async () => {
    const rule = { limit: 2, windowSeconds: 60 };
    expect((await hit(d, "k", rule)).allowed).toBe(true);
    expect((await hit(d, "k", rule)).allowed).toBe(true);
    const third = await hit(d, "k", rule);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    await pool!.query("UPDATE app_rate_limits SET reset_at = now() - interval '1 second'");
    expect((await hit(d, "k", rule)).allowed).toBe(true);
  });

  it("moves a profile to a replacement tag and disables the old tag", async () => {
    const { tags } = await newBatch(2);
    await claim(tags[0].tagId, "alice", tags[0].claimCode);
    const [before] = await d.select().from(schema.profiles);

    const result = await claimTag(d, {
      tagId: tags[1].tagId,
      userId: "alice",
      ip: null,
      limitByIp: false,
      input: { mode: "move", claimCode: tags[1].claimCode, fromTagId: tags[0].tagId },
    });
    expect(result).toEqual({ ok: true });

    const old = await findTagById(d, tags[0].tagId);
    expect(old?.tag).toMatchObject({ status: "disabled", disabledReason: "replaced" });
    expect(old?.profile).toBeNull();
    const fresh = await findTagById(d, tags[1].tagId);
    expect(fresh?.profile?.id).toBe(before.id);
  });

  it("can't move someone else's profile, and a failed move leaves the new tag unclaimed", async () => {
    const { tags } = await newBatch(2);
    await claim(tags[0].tagId, "alice", tags[0].claimCode);
    const result = await claimTag(d, {
      tagId: tags[1].tagId,
      userId: "bob",
      ip: null,
      limitByIp: false,
      input: { mode: "move", claimCode: tags[1].claimCode, fromTagId: tags[0].tagId },
    });
    expect(result).toEqual({ ok: false, error: "move_not_allowed" });
    expect((await findTagById(d, tags[1].tagId))?.tag.status).toBe("unclaimed");
    expect((await findTagById(d, tags[0].tagId))?.tag.ownerId).toBe("alice");
  });

  it("owners can disable and re-enable their tags; others can't", async () => {
    const { tags } = await newBatch(1);
    await claim(tags[0].tagId, "alice", tags[0].claimCode);
    expect(await disableOwnTag(d, "bob", tags[0].tagId)).toBe(false);
    expect(await disableOwnTag(d, "alice", tags[0].tagId)).toBe(true);
    expect(await enableOwnTag(d, "bob", tags[0].tagId)).toBe(false);
    expect(await enableOwnTag(d, "alice", tags[0].tagId)).toBe(true);
    expect((await listOwnedTags(d, "alice"))[0]).toMatchObject({ status: "active", profileType: "lost_pet" });
  });

  it("owners can't undo an admin disable; admins can", async () => {
    const { tags } = await newBatch(2);
    await claim(tags[0].tagId, "alice", tags[0].claimCode);
    expect(await adminDisableTag(d, "admin", tags[0].tagId)).toBe(true);
    expect(await enableOwnTag(d, "alice", tags[0].tagId)).toBe(false);
    expect(await adminEnableTag(d, "admin", tags[0].tagId)).toBe(true);
    expect((await findTagById(d, tags[0].tagId))?.tag.status).toBe("active");

    // An unclaimed tag goes back to unclaimed, and can't be claimed while disabled.
    await adminDisableTag(d, "admin", tags[1].tagId);
    expect(await claim(tags[1].tagId, "bob", tags[1].claimCode)).toEqual({ ok: false, error: "not_claimable" });
    await adminEnableTag(d, "admin", tags[1].tagId);
    expect((await findTagById(d, tags[1].tagId))?.tag.status).toBe("unclaimed");
  });

  it("reissuing claim codes replaces them for unclaimed tags only", async () => {
    const { batchId, tags } = await newBatch(2);
    await claim(tags[0].tagId, "alice", tags[0].claimCode);
    const reissued = await reissueClaimCodes(d, batchId, "admin");
    expect(reissued?.tags.map((t) => t.tagId)).toEqual([tags[1].tagId]);

    expect(await claim(tags[1].tagId, "bob", tags[1].claimCode)).toEqual({ ok: false, error: "invalid_code" });
    expect(await claim(tags[1].tagId, "bob", reissued!.tags[0].claimCode)).toEqual({ ok: true });

    const detail = await getBatch(d, batchId);
    expect(detail?.unclaimed).toBe(0);
    expect(await reissueClaimCodes(d, "b_doesnotexist", "admin")).toBeNull();
  });

  it("claims with the printed public code + claim code (no NFC)", async () => {
    const { tags } = await newBatch(1);
    const byCode = (publicCode: string, claimCode: string) =>
      claimByPublicCode(d, {
        publicCode,
        userId: "alice",
        ip: null,
        limitByIp: false,
        input: { mode: "new", claimCode, type: "business_card" },
      });
    expect(await byCode(tags[0].publicCode, "AAAAA-AAAAA")).toEqual({ ok: false, error: "invalid_code" });
    expect(await byCode(tags[0].publicCode.toLowerCase(), tags[0].claimCode)).toEqual({ ok: true });
    expect((await findTagById(d, tags[0].tagId))?.tag.ownerId).toBe("alice");
  });

  it("unknown public codes look like a wrong claim code and still count against the user's limit", async () => {
    const attempt = () =>
      claimByPublicCode(d, {
        publicCode: "ZZZZZZZZZZ",
        userId: "bob",
        ip: null,
        limitByIp: false,
        input: { mode: "new", claimCode: "AAAAA-AAAAA", type: "lost_pet" },
      });
    for (let i = 0; i < CLAIM_LIMITS.perUser.limit; i++)
      expect(await attempt()).toEqual({ ok: false, error: "invalid_code" });
    expect(await attempt()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("rejects malformed tag IDs before touching the database", async () => {
    expect(await findTagById(d, "../etc/passwd")).toBeNull();
    expect(await findTagById(d, "ABC")).toBeNull();
    const [row] = await d.select().from(schema.auditLog).where(eq(schema.auditLog.action, "tag.claimed"));
    expect(row).toBeUndefined();
  });
});
