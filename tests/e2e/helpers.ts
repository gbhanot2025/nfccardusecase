import { createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

const OUTBOX = ".mail-outbox-e2e";

/** Wait for the newest email to an address and return the first link in it. */
export async function latestLinkTo(to: string, subject: RegExp, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = (await readdir(OUTBOX).catch(() => [])).sort().reverse();
    for (const file of files) {
      const mail = JSON.parse(await readFile(path.join(OUTBOX, file), "utf8"));
      if (mail.to === to && subject.test(mail.subject)) {
        const match = String(mail.text).match(/https?:\/\/\S+/);
        if (match) return match[0];
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${to} matching ${subject}`);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) so tests can act like an authenticator app. */
export function totp(base32Secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

export const PASSWORD = "correct horse battery staple";

/** Fail the test if the page reports any Content-Security-Policy violation. */
export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

/** Sign up through the UI and open the verification link; lands on `expectUrl` (dashboard by default). */
export async function signUpAndVerify(page: Page, email: string, opts: { from?: string; expectUrl?: RegExp } = {}) {
  if (!opts.from) await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");

  await page.goto(await latestLinkTo(email, /verify/i));
  await expect(page).toHaveURL(opts.expectUrl ?? /\/dashboard$/);
}

/** Turn on authenticator-app 2FA from the security page; returns the TOTP secret. */
export async function enableTotp(page: Page): Promise<string> {
  await page.goto("/dashboard/security");
  await page.getByLabel("Confirm your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set up two-step verification" }).click();
  const secret = (await page.locator("code").innerText()).trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Confirm and turn on" }).click();
  await expect(page.getByText("Save these backup codes")).toBeVisible();
  return secret;
}
