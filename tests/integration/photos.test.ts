import "dotenv/config";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createBatch } from "@/server/batches";
import { getServableImage, removeProfileImage, uploadProfileImage } from "@/server/photos";
import { folderStorage, type Storage } from "@/server/storage";
import { adminDisableTag, claimTag } from "@/server/tags";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle({ client: pool, schema }) : undefined;

const png = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: "#3366ff" } })
    .png()
    .toBuffer();

describe.skipIf(!db)("profile photos", () => {
  const d = db!;
  let dir: string;
  let storage: Storage;
  let card: string;
  let wallet: string;

  beforeEach(async () => {
    await pool!.query('TRUNCATE "user", tags, tag_batches, audit_log, app_rate_limits CASCADE');
    dir = await mkdtemp(path.join(tmpdir(), "photos-"));
    storage = folderStorage(dir);
    await d.insert(schema.user).values([
      { id: "admin", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ]);
    const batch = await createBatch(
      d,
      { label: "B", formFactor: "card", allowedTypes: ["business_card", "lost_id"], quantity: 2 },
      "admin",
    );
    for (const [i, type] of (["business_card", "lost_id"] as const).entries()) {
      await claimTag(d, {
        tagId: batch.tags[i].tagId,
        userId: "alice",
        ip: null,
        limitByIp: false,
        input: { mode: "new", claimCode: batch.tags[i].claimCode, type },
      });
    }
    [card, wallet] = batch.tags.map((t) => t.tagId);
  });

  afterAll(async () => {
    await pool?.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function dataOf(tagId: string) {
    const [p] = await d.select().from(schema.profiles).where(eq(schema.profiles.tagId, tagId));
    return p.data as Record<string, string>;
  }

  it("stores a re-encoded photo, serves it while the tag is active, and replaces the old one", async () => {
    expect(
      await uploadProfileImage(d, storage, { userId: "alice", tagId: card, slot: "photoKey", file: await png() }),
    ).toEqual({
      ok: true,
    });
    const first = (await dataOf(card)).photoKey;
    expect(first).toMatch(/^p\/[0-9a-f-]{36}\/photo-[0-9a-f]{24}\.webp$/);
    const served = await getServableImage(d, storage, first, null);
    expect(served?.contentType).toBe("image/webp");
    expect((await sharp(Buffer.from(served!.body)).metadata()).format).toBe("webp");

    await uploadProfileImage(d, storage, { userId: "alice", tagId: card, slot: "photoKey", file: await png() });
    const second = (await dataOf(card)).photoKey;
    expect(second).not.toBe(first);
    expect(await storage.get(first)).toBeNull();
    expect(await getServableImage(d, storage, first, null)).toBeNull();
  });

  it("only the owner can upload, and lost wallet/ID profiles have no photo", async () => {
    expect(
      await uploadProfileImage(d, storage, { userId: "bob", tagId: card, slot: "photoKey", file: await png() }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await uploadProfileImage(d, storage, { userId: "alice", tagId: wallet, slot: "photoKey", file: await png() }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await uploadProfileImage(d, storage, {
        userId: "alice",
        tagId: card,
        slot: "logoKey",
        file: Buffer.from("nope"),
      }),
    ).toEqual({ ok: false, message: "That file isn't an image we can read." });
    expect(await readdir(dir)).toEqual([]);
  });

  it("stops serving images of disabled tags except to the owner, and removes images", async () => {
    await uploadProfileImage(d, storage, { userId: "alice", tagId: card, slot: "logoKey", file: await png() });
    const key = (await dataOf(card)).logoKey;
    await adminDisableTag(d, "admin", card);
    expect(await getServableImage(d, storage, key, null)).toBeNull();
    expect(await getServableImage(d, storage, key, "bob")).toBeNull();
    expect(await getServableImage(d, storage, key, "alice")).not.toBeNull();

    expect(await removeProfileImage(d, storage, { userId: "alice", tagId: card, slot: "logoKey" })).toBe(true);
    expect((await dataOf(card)).logoKey).toBeUndefined();
    expect(await storage.get(key)).toBeNull();
  });

  it("never serves unknown or malformed keys", async () => {
    expect(await getServableImage(d, storage, "p/x/photo-abc.webp", null)).toBeNull();
    expect(await getServableImage(d, storage, "../../etc/passwd", null)).toBeNull();
  });
});
