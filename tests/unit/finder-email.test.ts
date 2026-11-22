import { describe, expect, it } from "vitest";
import { finderMessageEmail } from "@/lib/email";

describe("finder message email", () => {
  it("escapes everything the finder typed and keeps the subject fixed", () => {
    const mail = finderMessageEmail({
      to: "owner@example.com",
      itemLabel: "pet",
      message: "<script>alert(1)</script>\r\nBcc: evil@example.com",
      finderContact: '"><img src=x onerror=alert(1)>',
      location: { latitude: 51.5, longitude: -0.12 },
      dashboardUrl: "http://localhost:3000/dashboard",
    });
    expect(mail.subject).toBe("Someone found your pet");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.text).toContain("openstreetmap.org/?mlat=51.5&mlon=-0.12");
    expect(mail.html).toContain("See the location they shared");
  });

  it("says when there's no contact or location", () => {
    const mail = finderMessageEmail({
      to: "o@example.com",
      itemLabel: "device",
      message: "hi",
      dashboardUrl: "http://x",
    });
    expect(mail.text).toContain("They didn't leave contact details.");
    expect(mail.text).not.toContain("openstreetmap");
  });
});
