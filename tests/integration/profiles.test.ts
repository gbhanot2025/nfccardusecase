import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createBatch } from "@/server/batches";
import { getOwnedProfile, saveProfileData, setLostMode } from "@/server/profiles";
import { claimTag } from "@/server/tags";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle({ client: pool, schema }) : undefined;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe.skipIf(!db)("saving profiles", () => {
  const d = db!;
  let cardTag: string;
  let petTag: string;

  beforeEach(async () => {
    await pool!.query('TRUNCATE "user", tags, tag_batches, audit_log, app_rate_limits CASCADE');
    await d.insert(schema.user).values([
      { id: "admin", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ]);
    const batch = await createBatch(
      d,
      { label: "B", formFactor: "card", allowedTypes: ["business_card", "lost_pet"], quantity: 2 },
      "admin",
    );
    [cardTag, petTag] = batch.tags.map((t) => t.tagId);
    for (const [i, type] of (["business_card", "lost_pet"] as const).entries()) {
      await claimTag(d, {
        tagId: batch.tags[i].tagId,
        userId: "alice",
        ip: null,
        limitByIp: false,
        input: { mode: "new", claimCode: batch.tags[i].claimCode, type },
      });
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("validates and saves the owner's business card, normalising phones to E.164", async () => {
    const result = await saveProfileData(
      d,
      "alice",
      cardTag,
      form({ name: "Ada Lovelace", "phones.0.label": "mobile", "phones.0.number": "+44 20 7946 0958" }),
    );
    expect(result).toEqual({ status: "saved", message: "Saved." });
    const owned = await getOwnedProfile(d, "alice", cardTag);
    expect(owned?.profile.data).toMatchObject({
      name: "Ada Lovelace",
      phones: [{ label: "mobile", number: "+442079460958" }],
    });
  });

  it("rejects invalid input with field errors and doesn't write", async () => {
    const result = await saveProfileData(
      d,
      "alice",
      cardTag,
      form({ name: "Ada", website: "http://insecure.example", "phones.0.number": "020 7946 0958" }),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(["website", "phones.0.number"]));
    }
    expect((await getOwnedProfile(d, "alice", cardTag))?.profile.data).toEqual({});
  });

  it("only the owner can save or toggle lost mode", async () => {
    expect(await saveProfileData(d, "bob", petTag, form({ petName: "Stolen" }))).toMatchObject({ status: "error" });
    expect(await setLostMode(d, "bob", petTag, true)).toBe(false);
    expect(await getOwnedProfile(d, "bob", petTag)).toBeNull();
    expect((await getOwnedProfile(d, "alice", petTag))?.profile).toMatchObject({ data: {}, lostMode: false });
  });

  it("keeps server-managed image keys and marks a pet with a chip number as microchipped", async () => {
    const owned = await getOwnedProfile(d, "alice", petTag);
    await d
      .update(schema.profiles)
      .set({ data: { petName: "Old", photoKey: "profiles/abc/photo.jpg" } })
      .where(eq(schema.profiles.id, owned!.profile.id));

    const result = await saveProfileData(
      d,
      "alice",
      petTag,
      form({ petName: "Biscuit", microchipNumber: "985-112-003-456-789", photoKey: "profiles/evil/other.jpg" }),
    );
    expect(result.status).toBe("saved");
    const data = (await getOwnedProfile(d, "alice", petTag))?.profile.data;
    expect(data).toMatchObject({
      petName: "Biscuit",
      microchipped: true,
      microchipNumber: "985112003456789",
      photoKey: "profiles/abc/photo.jpg",
    });
  });

  it("lost mode is only for lost-item profiles", async () => {
    expect(await setLostMode(d, "alice", petTag, true)).toBe(true);
    expect((await getOwnedProfile(d, "alice", petTag))?.profile.lostMode).toBe(true);
    expect(await setLostMode(d, "alice", cardTag, true)).toBe(false);
    expect((await getOwnedProfile(d, "alice", cardTag))?.profile.lostMode).toBe(false);
  });
});
