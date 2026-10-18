import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/csp";

describe("Content-Security-Policy", () => {
  const prod = buildCsp("abc123", false);

  it("uses the nonce for scripts and styles", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).toContain("style-src 'self' 'nonce-abc123'");
  });

  it("never allows unsafe-inline, and unsafe-eval only in development", () => {
    expect(prod).not.toContain("unsafe-inline");
    expect(prod).not.toContain("unsafe-eval");
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
    expect(buildCsp("n", true)).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("blocks framing, plugins and foreign form posts", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("upgrade-insecure-requests");
  });
});
