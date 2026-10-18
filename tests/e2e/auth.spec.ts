import { expect, type Page, test } from "@playwright/test";
import { latestLinkTo, totp, uniqueEmail } from "./helpers";

const PASSWORD = "correct horse battery staple";

/** Fail the test if the page reports any Content-Security-Policy violation. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

async function signUpAndVerify(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");

  await page.goto(await latestLinkTo(email, /verify/i));
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Your tags" })).toBeVisible();
}

test("sign up, verify email, log out and log back in", async ({ page }) => {
  const csp = watchCsp(page);
  const email = uniqueEmail("basic");
  await signUpAndVerify(page, email);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong password value");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.locator(".alert.error")).toHaveText("Incorrect email or password.");

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  expect(csp).toEqual([]);
});

test("dashboard redirects to login when signed out", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});

test("unverified accounts cannot log in", async ({ page }) => {
  const email = uniqueEmail("unverified");
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Unverified");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("verify your email");
});

test("turn on two-step verification and log in with a code", async ({ page }) => {
  const csp = watchCsp(page);
  const email = uniqueEmail("totp");
  await signUpAndVerify(page, email);

  await page.goto("/dashboard/security");
  await page.getByLabel("Confirm your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set up two-step verification" }).click();
  await expect(page.getByAltText("QR code for your authenticator app")).toBeVisible();

  const secret = (await page.locator("code").innerText()).trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Confirm and turn on" }).click();
  await expect(page.getByText("Save these backup codes")).toBeVisible();

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  await expect(page).toHaveURL(/\/two-factor/);
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.locator(".alert.error")).toContainText("didn't work");

  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  expect(csp).toEqual([]);
});

test("password reset", async ({ page }) => {
  const email = uniqueEmail("reset");
  await signUpAndVerify(page, email);
  await page.getByRole("button", { name: "Log out" }).click();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");

  await page.goto(await latestLinkTo(email, /reset/i));
  const newPassword = "a brand new long password";
  await page.getByLabel(/^New password/).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("status")).toContainText("password was changed");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
});
