import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { STORAGE_KEY_PATTERN } from "@/profile-types/shared/fields";

export type StoredObject = { body: Uint8Array; contentType: string };

/** Object storage for photos and logos. Keys are validated against STORAGE_KEY_PATTERN before any call. */
export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

function assertKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
}

/** S3-compatible storage (SeaweedFS in Docker, or any S3 provider). */
export function s3Storage(cfg: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}): Storage {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
  return {
    async put(key, body, contentType) {
      assertKey(key);
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      assertKey(key);
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        if (!res.Body) return null;
        return {
          body: await res.Body.transformToByteArray(),
          contentType: res.ContentType ?? "application/octet-stream",
        };
      } catch (err) {
        if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") return null;
        throw err;
      }
    },
    async delete(key) {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
  };
}

/** A local folder, for development and tests only (env validation refuses it in production). */
export function folderStorage(dir: string): Storage {
  const root = path.resolve(dir);
  const file = (key: string) => {
    assertKey(key);
    return path.join(root, key);
  };
  return {
    async put(key, body, contentType) {
      const p = file(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, body);
      await writeFile(`${p}.type`, contentType);
    },
    async get(key) {
      const p = file(key);
      try {
        return { body: await readFile(p), contentType: (await readFile(`${p}.type`, "utf8")).trim() };
      } catch {
        return null;
      }
    },
    async delete(key) {
      const p = file(key);
      await rm(p, { force: true });
      await rm(`${p}.type`, { force: true });
    },
  };
}

let storage: Storage | undefined;

export function getStorage(): Storage {
  if (storage) return storage;
  const e = env();
  if (e.STORAGE_DIR) storage = folderStorage(e.STORAGE_DIR);
  else if (e.S3_ENDPOINT && e.S3_BUCKET && e.S3_ACCESS_KEY && e.S3_SECRET_KEY) {
    storage = s3Storage({
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
    });
  } else throw new Error("No object storage configured (set S3_* or STORAGE_DIR)");
  return storage;
}
