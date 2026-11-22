import { describe, expect, it } from "vitest";
import { describeDevice, ipPrefix } from "@/server/scans";

describe("scan privacy helpers", () => {
  it("keeps only a network prefix of the IP", () => {
    expect(ipPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipPrefix("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd::/48");
    expect(ipPrefix("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(ipPrefix(null)).toBeNull();
    expect(ipPrefix("not an ip")).toBeNull();
  });

  it("describes the device coarsely", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
    expect(
      describeDevice(
        "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
      ),
    ).toBe("Android · Chrome");
    expect(describeDevice("curl/8.0")).toBe("Other device");
    expect(describeDevice(null)).toBeNull();
  });
});

describe("bot detection for scans", () => {
  it("skips previews and crawlers, keeps phones", async () => {
    const { isBot } = await import("@/server/scans");
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot("WhatsApp/2.23")).toBe(true);
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1")).toBe(false);
  });
});
