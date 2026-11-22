import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { env } from "@/lib/env";
import { auditLog, scanEvents, tags } from "@/lib/db/schema";
import { TAG_ID_PATTERN } from "./codes";
import {
  acceptTapCounter,
  keyProviderFromMasterKey,
  MasterKeyError,
  parseMasterKeyRef,
  readMasterKey,
  verifyTap,
} from "./ntag424";

/** Loads the master key for a key_ref (OpenBao KV version). Injected in tests. */
export type MasterKeyLoader = (keyRef: string) => Promise<Buffer>;

export const TEST_KEY_REF = "test:ntag424-master-key";

const keyCache = new Map<string, { key: Promise<Buffer>; expires: number }>();
const KEY_CACHE_MS = 10 * 60 * 1000;

/**
 * Default loader: OpenBao, cached in memory for 10 minutes per version so a tap doesn't wait on the vault.
 * Outside real deployments, NTAG424_TEST_MASTER_KEY stands in for OpenBao (key_ref "test:ntag424-master-key").
 */
export const loadMasterKey: MasterKeyLoader = async (keyRef) => {
  const testKey = env().NTAG424_TEST_MASTER_KEY;
  if (keyRef === TEST_KEY_REF) {
    if (!testKey) throw new MasterKeyError("test key_ref without NTAG424_TEST_MASTER_KEY");
    return Buffer.from(testKey, "hex");
  }
  const ref = parseMasterKeyRef(keyRef);
  if (!ref) throw new MasterKeyError("unrecognised key_ref");

  const cached = keyCache.get(keyRef);
  if (cached && cached.expires > Date.now()) return cached.key;
  const key = readMasterKey({ path: ref.path, version: ref.version }).then((k) => k.key);
  keyCache.set(keyRef, { key, expires: Date.now() + KEY_CACHE_MS });
  key.catch(() => keyCache.delete(keyRef));
  return key;
};

export type TapCheck =
  /** No SUN parameters: typed/copied link or not an NFC tap. */
  | { kind: "none" }
  /** Parameters present but not a fresh tap from this tag's chip (copied, replayed, wrong tag, not encoded). */
  | { kind: "unverified"; reason: string }
  | { kind: "verified"; counter: number };

/**
 * Check an NFC tap's SUN parameters for a tag and, if genuine and newer than any tap seen before, advance the
 * counter and record a scan. Never throws on visitor input; logs only the reason, never the parameters.
 *
 * This runs while rendering `/t/{tagId}` (a GET) on purpose: the chip produces a GET, and the only state it
 * changes is the forward-only counter, which a replayed or forged request can't move.
 */
export async function checkTap(
  db: Database,
  tag: { id: string; uid: string | null; keyRef: string | null },
  profileId: string | null,
  params: { picc?: unknown; cmac?: unknown },
  loader: MasterKeyLoader = loadMasterKey,
): Promise<TapCheck> {
  if (params.picc === undefined && params.cmac === undefined) return { kind: "none" };
  if (!tag.uid || !tag.keyRef) return { kind: "unverified", reason: "not_encoded" };

  let masterKey: Buffer;
  try {
    masterKey = await loader(tag.keyRef);
  } catch (err) {
    console.error(`Tap check: master key unavailable (${err instanceof MasterKeyError ? err.message : "error"})`);
    return { kind: "unverified", reason: "key_unavailable" };
  }

  const result = await verifyTap({ picc: params.picc, cmac: params.cmac }, keyProviderFromMasterKey(masterKey));
  if (!result.ok) return { kind: "unverified", reason: result.reason };
  if (result.uid !== tag.uid) return { kind: "unverified", reason: "uid_mismatch" };
  if (!(await acceptTapCounter(db, tag.id, result.counter))) return { kind: "unverified", reason: "replayed" };

  await db.insert(scanEvents).values({ tagId: tag.id, profileId, source: "nfc" });
  return { kind: "verified", counter: result.counter };
}

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const ENCODER_COLUMNS = ["tag_id", "uid", "encoded_at", "status", "key_ref"] as const;

const encoderRow = z.object({
  tag_id: z.string().regex(TAG_ID_PATTERN),
  uid: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(/^[0-9A-F]{14}$/)),
  encoded_at: z.iso.datetime({ offset: true, local: true }),
  status: z.literal("ok"),
  key_ref: z.string().refine((v) => v === TEST_KEY_REF || parseMasterKeyRef(v) !== null),
});

export const MAX_IMPORT_BYTES = 512 * 1024;

export type ImportResult = { updated: number; unchanged: number; skipped: number; errors: string[] };

/**
 * Import the encoder's results CSV for a batch: store each encoded tag's chip UID and key version.
 * Only rows with status "ok" count. A tag's UID can be set once (re-importing the same file is harmless);
 * a UID already used by another tag is reported, never overwritten.
 */
export async function importEncoderResults(
  db: Database,
  batchId: string,
  csvText: string,
  adminId: string,
): Promise<ImportResult> {
  const rows = parseCsv(csvText);
  const header = rows.shift();
  if (!header || header.join(",") !== ENCODER_COLUMNS.join(",")) {
    return { updated: 0, unchanged: 0, skipped: 0, errors: [`Expected columns: ${ENCODER_COLUMNS.join(",")}`] };
  }

  const result: ImportResult = { updated: 0, unchanged: 0, skipped: 0, errors: [] };
  const good: z.infer<typeof encoderRow>[] = [];
  for (const [i, cells] of rows.entries()) {
    // Failed encodings have no UID; they're expected, not errors.
    if (cells[ENCODER_COLUMNS.indexOf("status")] !== "ok") {
      result.skipped++;
      continue;
    }
    const parsed = encoderRow.safeParse(Object.fromEntries(ENCODER_COLUMNS.map((c, j) => [c, cells[j] ?? ""])));
    if (!parsed.success) {
      result.errors.push(`Line ${i + 2}: not a valid encoder result`);
      continue;
    }
    good.push(parsed.data);
  }
  if (good.length === 0) return result;

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: tags.id, uid: tags.uid, batchId: tags.batchId })
      .from(tags)
      .where(inArray(tags.uid, [...new Set(good.map((r) => r.uid))]));
    const uidOwner = new Map(existing.map((t) => [t.uid, t.id]));

    for (const row of good) {
      const owner = uidOwner.get(row.uid);
      if (owner && owner !== row.tag_id) {
        result.errors.push(`Tag ${row.tag_id}: chip ${row.uid} is already linked to another tag`);
        continue;
      }
      if (owner === row.tag_id) {
        result.unchanged++;
        continue;
      }
      const updated = await tx
        .update(tags)
        .set({ uid: row.uid, keyRef: row.key_ref, encodedAt: new Date(row.encoded_at) })
        .where(and(eq(tags.id, row.tag_id), eq(tags.batchId, batchId), isNull(tags.uid)))
        .returning({ id: tags.id });
      if (updated.length === 1) {
        result.updated++;
        uidOwner.set(row.uid, row.tag_id);
      } else result.errors.push(`Tag ${row.tag_id}: not in this batch, or already linked to a different chip`);
    }

    await tx.insert(auditLog).values({
      actorUserId: adminId,
      action: "batch.encoder_results_imported",
      targetType: "tag_batch",
      targetId: batchId,
      metadata: { updated: result.updated, unchanged: result.unchanged, errors: result.errors.length },
    });
  });
  return result;
}
