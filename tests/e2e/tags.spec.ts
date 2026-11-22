import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { enableTotp, signUpAndVerify, uniqueEmail, watchCsp } from "./helpers";

type IssuedLabel = { tagId: string; publicCode: string; claimCode: string };

/** Make a verified user an admin with the real CLI, then turn on 2FA (required for the admin area). */
async function becomeAdmin(page: Page) {
  const email = uniqueEmail("admin");
  await signUpAndVerify(page, email);
  execFileSync("npx", ["tsx", "scripts/grant-admin.ts", email], { stdio: "pipe" });
  await enableTotp(page);
}

async function createBatch(page: Page, quantity: number): Promise<{ batchId: string; labels: IssuedLabel[] }> {
  await page.goto("/admin");
  await page.getByRole("link", { name: "New batch" }).click();
  await page.getByLabel("Batch name").fill("E2E batch");
  await page.getByLabel(/Number of tags/).fill(String(quantity));
  await page.getByRole("button", { name: "Generate batch" }).click();
  await expect(page.getByText("Save these claim codes now.")).toBeVisible();

  // The one-time CSV must contain every claim code shown on the labels.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  expect(csv.split("\r\n")[0]).toBe("batch_id,tag_id,public_code,nfc_url,qr_url,claim_code");

  const labels: IssuedLabel[] = [];
  for (const label of await page.locator(".label").all()) {
    const item = {
      tagId: (await label.getAttribute("data-tag-id"))!,
      publicCode: (await label.locator(".code").innerText()).trim(),
      claimCode: (await label.locator(".claim-code").innerText()).trim(),
    };
    expect(csv).toContain(`"${item.tagId}","${item.publicCode}"`);
    expect(csv).toContain(item.claimCode);
    labels.push(item);
  }
  expect(labels).toHaveLength(quantity);
  await expect(page.locator(".label svg").first()).toBeVisible();

  await page.getByRole("link", { name: "Go to batch" }).click();
  await page.waitForURL(/\/admin\/batches\/b_[0-9a-z]{12}$/);
  const batchId = page.url().split("/").at(-1)!;
  await expect(page.getByRole("heading", { name: "E2E batch" })).toBeVisible();
  for (const l of labels) await expect(page.getByRole("cell", { name: l.tagId })).toBeVisible();
  return { batchId, labels };
}

async function newVisitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test("admin area needs an admin with two-step verification", async ({ page }) => {
  const email = uniqueEmail("notadmin");
  await signUpAndVerify(page, email);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard$/);

  execFileSync("npx", ["tsx", "scripts/grant-admin.ts", email], { stdio: "pipe" });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard\/security\?admin=1/);
  await expect(page.locator(".alert.error")).toContainText("Turn on two-step verification");
});

test("batch → tap → sign up → claim → turn off → replace", async ({ page, browser }) => {
  const csp = watchCsp(page);
  await becomeAdmin(page);
  const { labels } = await createBatch(page, 2);
  const [first, second] = labels;

  // A customer taps the new tag: it asks them to create an account, then brings them back.
  const customer = await newVisitor(browser);
  const customerCsp = watchCsp(customer);
  await customer.goto(`/t/${first.tagId}`);
  await expect(customer.getByRole("heading", { name: "Activate your tag" })).toBeVisible();
  await customer.getByRole("link", { name: "Create account" }).click();
  await signUpAndVerify(customer, uniqueEmail("customer"), {
    from: "tag",
    expectUrl: new RegExp(`/t/${first.tagId}$`),
  });

  // The QR link never offers claiming.
  const stranger = await newVisitor(browser);
  await stranger.goto(`/q/${first.publicCode}`);
  await expect(stranger.getByRole("heading", { name: "This tag isn't active yet" })).toBeVisible();
  await expect(stranger.getByLabel("Claim code")).toHaveCount(0);

  // Wrong code, then the right one typed loosely.
  await customer.getByLabel("Claim code").fill("AAAAA-AAAAA");
  await customer.getByLabel(/Lost pet/).check();
  await customer.getByRole("button", { name: "Activate tag" }).click();
  await expect(customer.locator(".alert.error")).toContainText("doesn't match");
  await customer.getByLabel("Claim code").fill(first.claimCode.toLowerCase().replace("-", " "));
  await customer.getByLabel(/Lost pet/).check();
  await customer.getByRole("button", { name: "Activate tag" }).click();
  await expect(customer).toHaveURL(/\/dashboard\?claimed=/);
  await expect(customer.getByRole("status").first()).toContainText("Your tag is activated");
  const list = customer.getByRole("list", { name: "Your tags" });
  await expect(list).toContainText("Lost pet");
  await expect(list).toContainText(first.publicCode);

  // Visitors now see the (not yet set up) profile, never a claim form.
  await stranger.goto(`/t/${first.tagId}`);
  await expect(stranger.getByRole("heading", { name: "Lost pet" })).toBeVisible();
  await expect(stranger.getByLabel("Claim code")).toHaveCount(0);

  // The customer loses the tag and turns it off.
  customer.on("dialog", (d) => d.accept());
  await customer.getByRole("button", { name: "Turn off" }).click();
  await expect(customer.getByRole("button", { name: "Turn on" })).toBeVisible();
  await stranger.goto(`/q/${first.publicCode}`);
  await expect(stranger.getByRole("heading", { name: "This tag is no longer active" })).toBeVisible();

  // A replacement tag takes over the same profile.
  await customer.goto(`/t/${second.tagId}`);
  await customer.getByLabel("Claim code").fill(second.claimCode);
  await customer.getByLabel(new RegExp(`from tag ${first.publicCode}`)).check();
  await customer.getByRole("button", { name: "Activate tag" }).click();
  await expect(customer).toHaveURL(/\/dashboard\?claimed=/);
  await expect(list).toContainText("Replaced");
  await expect(list).toContainText(second.publicCode);

  // A second person can't claim an already-claimed tag.
  await stranger.goto(`/t/${second.tagId}`);
  await expect(stranger.getByRole("heading", { name: "Lost pet" })).toBeVisible();

  expect(csp).toEqual([]);
  expect(customerCsp).toEqual([]);
});

test("admin can disable a tag and print a QR-only sheet", async ({ page, browser }) => {
  await becomeAdmin(page);
  const { batchId, labels } = await createBatch(page, 1);

  await page.goto(`/admin?q=${labels[0].publicCode}`);
  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("disabled (by admin)")).toBeVisible();

  const visitor = await newVisitor(browser);
  await visitor.goto(`/t/${labels[0].tagId}`);
  await expect(visitor.getByRole("heading", { name: "This tag is no longer active" })).toBeVisible();

  await page.getByRole("button", { name: "Enable" }).click();
  await expect(page.getByText("unclaimed")).toBeVisible();

  await page.goto(`/admin/batches/${batchId}/qr`);
  await expect(page.locator(".label")).toHaveCount(1);
  await expect(page.locator(".claim-code")).toHaveCount(0);
});

test("activate without NFC using the printed codes", async ({ page, browser }) => {
  await becomeAdmin(page);
  const { labels } = await createBatch(page, 1);
  const [tag] = labels;

  // The QR page links to code activation; it asks for an account first and comes back.
  const customer = await newVisitor(browser);
  const csp = watchCsp(customer);
  await customer.goto(`/q/${tag.publicCode}`);
  await customer.getByRole("link", { name: "Activate with the printed codes" }).click();
  await expect(customer).toHaveURL(/\/login\?next=%2Factivate%2F/);
  await customer.getByRole("link", { name: "Create one" }).click();
  await signUpAndVerify(customer, uniqueEmail("nonfc"), {
    from: "activate",
    expectUrl: new RegExp(`/activate/${tag.publicCode}$`),
  });

  // Typing the code by hand also works, with spaces and lowercase.
  await customer.goto("/activate");
  await customer
    .getByLabel("Code under the QR code")
    .fill(`${tag.publicCode.slice(0, 5).toLowerCase()} ${tag.publicCode.slice(5)}`);
  await customer.getByRole("button", { name: "Continue" }).click();
  await expect(customer).toHaveURL(new RegExp(`/activate/${tag.publicCode}$`));

  await customer.getByLabel("Claim code").fill("AAAAA-AAAAA");
  await customer.getByLabel(/Digital business card/).check();
  await customer.getByRole("button", { name: "Activate tag" }).click();
  await expect(customer.locator(".alert.error")).toContainText("doesn't match");

  await customer.getByLabel("Claim code").fill(tag.claimCode);
  await customer.getByLabel(/Digital business card/).check();
  await customer.getByRole("button", { name: "Activate tag" }).click();
  await expect(customer).toHaveURL(/\/dashboard\?claimed=/);
  await expect(customer.getByRole("list", { name: "Your tags" })).toContainText("Digital business card");

  await customer.goto(`/activate/${tag.publicCode}`);
  await expect(customer.locator(".alert.error")).toContainText("already activated");
  expect(csp).toEqual([]);
});

test("unknown tags and codes are a plain 404", async ({ page }) => {
  for (const path of ["/t/0000000000000000", "/t/not-a-tag", "/q/ZZZZZZZZZZ", "/q/zz"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});
