import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

let transporter: Transporter | undefined;

/**
 * Sends an email via SMTP, or (development/tests only) writes it to MAIL_OUTBOX_DIR as JSON.
 * Never logs recipients or bodies: they contain personal data and one-time links.
 */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const config = env();

  if (config.SMTP_URL) {
    transporter ??= nodemailer.createTransport(config.SMTP_URL);
    await transporter.sendMail({ from: config.MAIL_FROM, ...message });
    return;
  }

  // Env validation only permits the outbox outside real deployments (development, tests, localhost).
  if (config.MAIL_OUTBOX_DIR) {
    await mkdir(config.MAIL_OUTBOX_DIR, { recursive: true });
    const file = path.join(config.MAIL_OUTBOX_DIR, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(file, JSON.stringify({ from: config.MAIL_FROM, ...message }, null, 2));
    return;
  }

  throw new Error("No email transport configured");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function actionEmail(opts: { to: string; subject: string; intro: string; action: string; url: string; outro: string }) {
  const appName = env().APP_NAME;
  const text = `${opts.intro}\n\n${opts.action}: ${opts.url}\n\n${opts.outro}\n\n— ${appName}`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>${escapeHtml(opts.intro)}</p>
<p><a href="${escapeHtml(opts.url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(opts.action)}</a></p>
<p style="color:#555;font-size:14px">${escapeHtml(opts.outro)}</p>
<p style="color:#555;font-size:14px">— ${escapeHtml(appName)}</p>
</body></html>`;
  return { to: opts.to, subject: opts.subject, text, html };
}

export function verificationEmail(to: string, url: string): OutgoingEmail {
  return actionEmail({
    to,
    subject: "Verify your email",
    intro: "Confirm your email address to finish creating your account.",
    action: "Verify email",
    url,
    outro: "This link expires in 1 hour. If you didn't sign up, you can ignore this email.",
  });
}

export function resetPasswordEmail(to: string, url: string): OutgoingEmail {
  return actionEmail({
    to,
    subject: "Reset your password",
    intro: "We received a request to reset your password.",
    action: "Choose a new password",
    url,
    outro: "This link expires in 1 hour. If you didn't ask for this, ignore this email; your password stays the same.",
  });
}

export function existingAccountEmail(to: string, loginUrl: string): OutgoingEmail {
  return actionEmail({
    to,
    subject: "Someone tried to sign up with your email",
    intro: "A sign-up was attempted with this email address, but you already have an account.",
    action: "Log in",
    url: loginUrl,
    outro:
      "If this wasn't you, no action is needed. If you forgot your password, use 'Forgot password' on the login page.",
  });
}
