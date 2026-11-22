import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createBatch } from "@/server/batches";
import { checkTap, importEncoderResults, parseCsv } from "@/server/taps";
import { claimTag, findTagById } from "@/server/tags";

// Taps produced by the simulated NTAG 424 DNA in encoder/tests (shared with the Python encoder).
const vectors = JSON.parse(readFileSync("tests/fixtures/ntag424-vectors.json", "utf8")) as {
  masterKey: string;
  taps: { uid: string; counter: number; picc: string; cmac: string }[];
};
const [tap2, tap3] = vectors.taps;
const UID = tap2.uid;
const KEY_REF = "openbao:ntag424/master-key@1";
const loader = async () => Buffer.from(vectors.masterKey, "hex");

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle({ client: pool, schema }) : undefined;

function resultsCsv(rows: string[][]): string {
  return ["tag_id,uid,encoded_at,status,key_ref", ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
}

describe("CSV parsing", () => {
  it("handles quotes, doubled quotes, CRLF and blank lines", () => {
    expect(parseCsv('a,"b,c","d""e"\r\n\r\n1,2,3\n')).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "2", "3"],
    ]);
  });
});

describe.skipIf(!db)("NFC tap verification", () => {
  const d = db!;
  let tagId: string;
  let otherTagId: string;
  let batchId: string;

  beforeEach(async () => {
    await pool!.query('TRUNCATE "user", tags, tag_batches, audit_log, app_rate_limits CASCADE');
    await d.insert(schema.user).values([
      { id: "admin", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "alice", name: "Alice", email: "alice@example.com" },
    ]);
    const batch = await createBatch(
      d,
      { label: "Encoded", formFactor: "card", allowedTypes: ["lost_pet"], quantity: 2 },
      "admin",
    );
    batchId = batch.batchId;
    tagId = batch.tags[0].tagId;
    otherTagId = batch.tags[1].tagId;
    await claimTag(d, {
      tagId,
      userId: "alice",
      ip: null,
      limitByIp: false,
      input: { mode: "new", claimCode: batch.tags[0].claimCode, type: "lost_pet" },
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function encodeTag() {
    const r = await importEncoderResults(
      d,
      batchId,
      resultsCsv([[tagId, UID, "2026-11-22T15:00:00+00:00", "ok", KEY_REF]]),
      "admin",
    );
    expect(r).toMatchObject({ updated: 1, errors: [] });
  }

  async function tap(id: string, params: { picc?: unknown; cmac?: unknown }) {
    const found = (await findTagById(d, id))!;
    return checkTap(d, found.tag, params, loader);
  }

  it("treats a visit without parameters as a plain link", async () => {
    expect(await tap(tagId, {})).toEqual({ kind: "none" });
  });

  it("can't verify a tag that hasn't been linked to a chip", async () => {
    expect(await tap(tagId, { picc: tap2.picc, cmac: tap2.cmac })).toEqual({
      kind: "unverified",
      reason: "not_encoded",
    });
  });

  it("verifies a genuine tap and rejects replays", async () => {
    await encodeTag();
    expect(await tap(tagId, { picc: tap2.picc, cmac: tap2.cmac })).toEqual({ kind: "verified", counter: 2 });
    expect(await tap(tagId, { picc: tap2.picc, cmac: tap2.cmac })).toEqual({
      kind: "unverified",
      reason: "replayed",
    });
    expect(await tap(tagId, { picc: tap3.picc, cmac: tap3.cmac })).toEqual({ kind: "verified", counter: 3 });
    expect(await tap(tagId, { picc: tap2.picc, cmac: tap2.cmac })).toMatchObject({ reason: "replayed" });

    const [tag] = await d.select().from(schema.tags).where(eq(schema.tags.id, tagId));
    expect(tag.lastCounter).toBe(3);
  });

  it("rejects a genuine tap pasted onto another tag's URL", async () => {
    await encodeTag();
    await importEncoderResults(
      d,
      batchId,
      resultsCsv([[otherTagId, "04FFFFFFFFFFFF", "2026-11-22T15:00:00Z", "ok", KEY_REF]]),
      "admin",
    );
    expect(await tap(otherTagId, { picc: tap2.picc, cmac: tap2.cmac })).toEqual({
      kind: "unverified",
      reason: "uid_mismatch",
    });
  });

  it("rejects tampered, malformed and array parameters, and a missing key", async () => {
    await encodeTag();
    const badCmac = tap2.cmac.slice(0, -1) + (tap2.cmac.endsWith("0") ? "1" : "0");
    expect(await tap(tagId, { picc: tap2.picc, cmac: badCmac })).toMatchObject({ reason: "bad_cmac" });
    expect(await tap(tagId, { picc: "zz", cmac: tap2.cmac })).toMatchObject({ reason: "invalid_format" });
    expect(await tap(tagId, { picc: [tap2.picc, tap2.picc], cmac: tap2.cmac })).toMatchObject({
      reason: "invalid_format",
    });
    const found = (await findTagById(d, tagId))!;
    const failing = async () => {
      throw new Error("vault down");
    };
    expect(await checkTap(d, found.tag, { picc: tap2.picc, cmac: tap2.cmac }, failing)).toEqual({
      kind: "unverified",
      reason: "key_unavailable",
    });
  });

  it("imports encoder results safely", async () => {
    const csv = resultsCsv([
      [tagId, UID.toLowerCase(), "2026-11-22T15:00:00+00:00", "ok", KEY_REF],
      [otherTagId, "", "2026-11-22T15:01:00+00:00", "auth_failed", KEY_REF],
      ["../../etc", UID, "2026-11-22T15:00:00+00:00", "ok", KEY_REF],
    ]);
    expect(await importEncoderResults(d, batchId, csv, "admin")).toEqual({
      updated: 1,
      unchanged: 0,
      skipped: 1,
      errors: ["Line 4: not a valid encoder result"],
    });
    // Re-importing is harmless; the same chip can't be linked to a second tag.
    expect(await importEncoderResults(d, batchId, csv, "admin")).toMatchObject({ updated: 0, unchanged: 1 });
    const dup = await importEncoderResults(
      d,
      batchId,
      resultsCsv([[otherTagId, UID, "2026-11-22T15:00:00Z", "ok", KEY_REF]]),
      "admin",
    );
    expect(dup.updated).toBe(0);
    expect(dup.errors[0]).toMatch(/already linked to another tag/);
    // Wrong batch and wrong columns are refused.
    expect(
      (
        await importEncoderResults(
          d,
          "b_000000000000",
          resultsCsv([[otherTagId, "04AAAAAAAAAAAA", "2026-11-22T15:00:00Z", "ok", KEY_REF]]),
          "admin",
        )
      ).errors[0],
    ).toMatch(/not in this batch/);
    expect((await importEncoderResults(d, batchId, "a,b\n1,2\n", "admin")).errors[0]).toMatch(/Expected columns/);

    const [tag] = await d.select().from(schema.tags).where(eq(schema.tags.id, tagId));
    expect(tag).toMatchObject({ uid: UID, keyRef: KEY_REF });
    expect(tag.encodedAt?.toISOString()).toBe("2026-11-22T15:00:00.000Z");
  });
});
