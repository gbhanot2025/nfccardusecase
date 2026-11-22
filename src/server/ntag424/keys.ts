import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";

/**
 * Reads the NTAG 424 master key from OpenBao (KV v2) over its HTTP API.
 * Secret layout (written by an operator, see ./README.md):
 *   mount "secret", path "ntag424/master-key", field "key" = 32 hex chars (AES-128)
 * Every KV v2 write creates a new version; tags record which version encoded them
 * (key_ref "openbao:ntag424/master-key@<version>"), so rotation never breaks old tags.
 *
 * Never logs or returns the token, and never puts the key in an error message.
 */
export const DEFAULT_KV_MOUNT = "secret";
export const DEFAULT_MASTER_KEY_PATH = "ntag424/master-key";

export interface MasterKey {
  key: Buffer;
  version: number;
  /** Value to store in tags.key_ref. Contains no secret. */
  keyRef: string;
}

export interface ReadMasterKeyOptions {
  /** A specific KV version (from the tag's key_ref); latest if omitted. */
  version?: number;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Defaults to OPENBAO_ADDR / OPENBAO_TOKEN from env(), read lazily on call. */
  addr?: string;
  token?: string;
  mount?: string;
  path?: string;
}

const kvResponseSchema = z.object({
  data: z.object({
    data: z.object({ key: z.string().regex(/^[0-9A-Fa-f]{32}$/) }),
    metadata: z.object({ version: z.number().int().positive() }),
  }),
});

const pathSegment = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

export class MasterKeyError extends Error {
  override name = "MasterKeyError";
}

export function masterKeyRef(path: string, version: number): string {
  return `openbao:${path}@${version}`;
}

/** Parse a key_ref written by the encoder back into path + version. */
export function parseMasterKeyRef(keyRef: string): { path: string; version: number } | null {
  const m = /^openbao:([A-Za-z0-9_/-]+)@([1-9][0-9]{0,8})$/.exec(keyRef);
  if (!m || !pathSegment.test(m[1])) return null;
  return { path: m[1], version: Number(m[2]) };
}

export async function readMasterKey(options: ReadMasterKeyOptions = {}): Promise<MasterKey> {
  const addr = options.addr ?? env().OPENBAO_ADDR;
  const token = options.token ?? env().OPENBAO_TOKEN;
  if (!addr || !token) throw new MasterKeyError("OPENBAO_ADDR and OPENBAO_TOKEN must be set");
  const mount = options.mount ?? DEFAULT_KV_MOUNT;
  const path = options.path ?? DEFAULT_MASTER_KEY_PATH;
  if (!pathSegment.test(mount) || !pathSegment.test(path)) throw new MasterKeyError("invalid OpenBao path");
  if (options.version !== undefined && (!Number.isInteger(options.version) || options.version < 1)) {
    throw new MasterKeyError("invalid key version");
  }

  const url = new URL(`/v1/${mount}/data/${path}`, addr);
  if (options.version !== undefined) url.searchParams.set("version", String(options.version));

  const doFetch = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "GET",
      headers: { "X-Vault-Token": token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new MasterKeyError("OpenBao request failed");
  }
  if (!res.ok) throw new MasterKeyError(`OpenBao returned HTTP ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new MasterKeyError("OpenBao returned invalid JSON");
  }
  const parsed = kvResponseSchema.safeParse(body);
  // Deliberately no detail from Zod: issues could echo parts of the secret.
  if (!parsed.success) throw new MasterKeyError("OpenBao secret has an unexpected shape");

  const { version } = parsed.data.data.metadata;
  return { key: Buffer.from(parsed.data.data.data.key, "hex"), version, keyRef: masterKeyRef(path, version) };
}
