import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const base = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(40),
  MAIL_OUTBOX_DIR: "./.mail-outbox",
};

const prod = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://tags.example.com",
  DATABASE_URL: "postgres://u:p@db:5432/db",
  BETTER_AUTH_SECRET: "y".repeat(48),
  SMTP_URL: "smtp://user:pass@smtp.example.com:587",
};

describe("environment validation", () => {
  it("accepts a valid development config", () => {
    const env = parseEnv(base);
    expect(env.NODE_ENV).toBe("development");
    expect(env.TRUSTED_PROXIES).toEqual([]);
    expect(env.AUTH_RATE_LIMIT).toBe("on");
  });

  it("accepts a valid production config", () => {
    expect(() => parseEnv(prod)).not.toThrow();
  });

  it("rejects a short auth secret", () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects a base URL with a trailing slash", () => {
    expect(() => parseEnv({ ...base, APP_BASE_URL: "http://localhost:3000/" })).toThrow(/APP_BASE_URL/);
  });

  it("requires some email transport in development", () => {
    expect(() => parseEnv({ ...base, MAIL_OUTBOX_DIR: undefined })).toThrow(/SMTP_URL/);
  });

  it("requires https, SMTP and rate limiting in production", () => {
    expect(() => parseEnv({ ...prod, APP_BASE_URL: "http://tags.example.com" })).toThrow(/https/);
    expect(() => parseEnv({ ...prod, SMTP_URL: undefined })).toThrow(/SMTP_URL/);
    expect(() => parseEnv({ ...prod, AUTH_RATE_LIMIT: "off" })).toThrow(/Rate limiting/);
    expect(() => parseEnv({ ...prod, MAIL_OUTBOX_DIR: "/tmp/out" })).toThrow(/outbox/);
  });

  it("never includes secret values in error messages", () => {
    const secret = "super-secret-value-that-must-not-leak";
    try {
      parseEnv({
        ...prod,
        BETTER_AUTH_SECRET: secret.slice(0, 10),
        SMTP_URL: `smtp://u:${secret}@h`,
        APP_BASE_URL: "nope",
      });
      throw new Error("expected failure");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(secret);
      expect(String((err as Error).message)).not.toContain(secret.slice(0, 10));
    }
  });

  it("allows a local production run on localhost only", () => {
    const local = {
      ...prod,
      APP_BASE_URL: "http://localhost:3100",
      SMTP_URL: undefined,
      MAIL_OUTBOX_DIR: "./out",
      AUTH_RATE_LIMIT: "off",
    };
    expect(() => parseEnv(local)).not.toThrow();
    expect(() => parseEnv({ ...local, APP_BASE_URL: "http://localhost.evil.example" })).toThrow();
    expect(() => parseEnv({ ...local, APP_BASE_URL: "http://10.0.0.5:3100" })).toThrow();
  });

  it("parses trusted proxies as a list", () => {
    expect(parseEnv({ ...base, TRUSTED_PROXIES: "10.0.0.2, 172.18.0.0/16" }).TRUSTED_PROXIES).toEqual([
      "10.0.0.2",
      "172.18.0.0/16",
    ]);
  });
});
