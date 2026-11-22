import { describe, expect, it } from "vitest";
import { ipRateKey, pickClientIp } from "@/server/request";

describe("client IP", () => {
  it("uses the last entry when no proxies are configured (Caddy replaces the header)", () => {
    expect(pickClientIp("203.0.113.9", [])).toBe("203.0.113.9");
    expect(pickClientIp("1.2.3.4, 203.0.113.9", [])).toBe("203.0.113.9");
  });

  it("skips trusted proxies from the right, and never trusts anything left of junk", () => {
    expect(pickClientIp("6.6.6.6, 203.0.113.9, 172.18.0.5", ["172.16.0.0/12"])).toBe("203.0.113.9");
    expect(pickClientIp("203.0.113.9, 10.0.0.1, 10.0.0.2", ["10.0.0.0/8"])).toBe("203.0.113.9");
    expect(pickClientIp("6.6.6.6, not-an-ip, 172.18.0.5", ["172.16.0.0/12"])).toBeNull();
    expect(pickClientIp("172.18.0.5", ["172.16.0.0/12"])).toBeNull();
    expect(pickClientIp(null, [])).toBeNull();
    expect(pickClientIp("", [])).toBeNull();
  });

  it("handles IPv6 and IPv4-mapped addresses", () => {
    expect(pickClientIp("2001:db8::1", ["172.16.0.0/12"])).toBe("2001:db8::1");
    expect(pickClientIp("::ffff:203.0.113.9", [])).toBe("203.0.113.9");
  });

  it("rate-limits IPv6 per /64", () => {
    expect(ipRateKey("2001:db8:1:2::99")).toBe("2001:db8:1:2::/64");
    expect(ipRateKey("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipRateKey("203.0.113.9")).toBe("203.0.113.9");
    expect(ipRateKey("unknown")).toBe("unknown");
  });
});
