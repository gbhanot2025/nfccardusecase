import { beforeAll, describe, expect, it } from "vitest";
import { escapeHtml, resetPasswordEmail, verificationEmail } from "@/lib/email";

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgres://u:p@localhost/db";
  process.env.BETTER_AUTH_SECRET = "z".repeat(40);
  process.env.MAIL_OUTBOX_DIR = "./.mail-outbox";
  process.env.APP_NAME = "Test <App>";
});

describe("email templates", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("includes the action link in text and escaped HTML", () => {
    const url = 'http://localhost:3000/api/auth/verify-email?token=abc&x="><script>';
    const mail = verificationEmail("a@example.com", url);
    expect(mail.text).toContain(url);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&quot;&gt;&lt;script&gt;");
    expect(mail.html).toContain("Test &lt;App&gt;");
  });

  it("builds a reset email addressed to the user", () => {
    const mail = resetPasswordEmail("b@example.com", "http://localhost:3000/reset");
    expect(mail.to).toBe("b@example.com");
    expect(mail.subject).toMatch(/reset/i);
  });
});
