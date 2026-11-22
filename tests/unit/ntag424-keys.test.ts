import { describe, expect, it, vi } from "vitest";
import { MasterKeyError, parseMasterKeyRef, readMasterKey } from "@/server/ntag424/keys";

const KEY_HEX = "00112233445566778899aabbccddeeff";
const TOKEN = "s.dev-token-must-not-leak";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const okBody = (version = 3, key = KEY_HEX) => ({ data: { data: { key }, metadata: { version } } });

describe("readMasterKey (OpenBao KV v2)", () => {
  const base = { addr: "http://openbao.test:8200", token: TOKEN };

  it("reads the latest version with the token header", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()));
    const mk = await readMasterKey({ ...base, fetchImpl });
    expect(mk.key.toString("hex")).toBe(KEY_HEX);
    expect(mk.version).toBe(3);
    expect(mk.keyRef).toBe("openbao:ntag424/master-key@3");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://openbao.test:8200/v1/secret/data/ntag424/master-key");
    expect((init.headers as Record<string, string>)["X-Vault-Token"]).toBe(TOKEN);
  });

  it("requests a specific version", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody(1)));
    await readMasterKey({ ...base, version: 1, fetchImpl });
    expect(String((fetchImpl.mock.calls[0] as unknown as [URL])[0])).toMatch(/\?version=1$/);
  });

  it.each([
    ["HTTP 403", () => new Response("permission denied", { status: 403 })],
    ["invalid JSON", () => new Response("not json", { status: 200 })],
    ["a short key", () => jsonResponse(okBody(3, KEY_HEX.slice(2)))],
    ["a non-hex key", () => jsonResponse(okBody(3, "zz" + KEY_HEX.slice(2)))],
    ["a missing version", () => jsonResponse({ data: { data: { key: KEY_HEX }, metadata: {} } })],
  ])("fails without leaking secrets on %s", async (_name, respond) => {
    const err = await readMasterKey({ ...base, fetchImpl: async () => respond() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MasterKeyError);
    const msg = String((err as Error).message);
    expect(msg).not.toContain(TOKEN);
    expect(msg).not.toContain(KEY_HEX.slice(2, 20));
  });

  it("fails cleanly when OpenBao is unreachable", async () => {
    const fetchImpl = async () => {
      throw new Error(`connect ECONNREFUSED token=${TOKEN}`);
    };
    const err = await readMasterKey({ ...base, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MasterKeyError);
    expect(String((err as Error).message)).not.toContain(TOKEN);
  });

  it("refuses path traversal and bad versions before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()));
    await expect(readMasterKey({ ...base, path: "../sys/raw", fetchImpl })).rejects.toThrow(MasterKeyError);
    await expect(readMasterKey({ ...base, mount: "secret?x=1", fetchImpl })).rejects.toThrow(MasterKeyError);
    await expect(readMasterKey({ ...base, version: 0, fetchImpl })).rejects.toThrow(MasterKeyError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires an address and token", async () => {
    await expect(readMasterKey({ addr: "http://x", token: "", fetchImpl: fetch })).rejects.toThrow(/OPENBAO/);
  });
});

describe("key_ref parsing", () => {
  it("round-trips the encoder's key_ref", () => {
    expect(parseMasterKeyRef("openbao:ntag424/master-key@12")).toEqual({ path: "ntag424/master-key", version: 12 });
  });

  it.each(["", "openbao:ntag424/master-key", "openbao:../x@1", "openbao:a@0", "vault:a@1", "openbao:a@1 "])(
    "rejects %j",
    (ref) => {
      expect(parseMasterKeyRef(ref)).toBeNull();
    },
  );
});
