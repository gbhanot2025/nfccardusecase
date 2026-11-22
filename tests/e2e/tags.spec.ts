import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { enableTotp, latestLinkTo, signUpAndVerify, uniqueEmail, watchCsp } from "./helpers";
import { randomUid, simulateTap } from "./ntag424-sim";

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

/** A separate person on a phone (a real user agent: headless browsers count as bots for scans). */
async function newVisitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
  });
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
  await expect(stranger.getByRole("heading", { name: "Pet tag" })).toBeVisible();
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
  await expect(stranger.getByRole("heading", { name: "Pet tag" })).toBeVisible();

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

test("genuine NFC taps are verified once; copies and replays are not", async ({ page, browser }) => {
  const MASTER = "000102030405060708090A0B0C0D0E0F";
  const csp = watchCsp(page);
  await becomeAdmin(page);
  const { labels } = await createBatch(page, 1);
  const [tag] = labels;
  const uid = randomUid();

  // Link the tag to its chip by uploading the encoder's results CSV.
  await page.getByLabel("Results CSV").setInputFiles({
    name: "results.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `tag_id,uid,encoded_at,status,key_ref\r\n${tag.tagId},${uid},2026-11-22T15:00:00+00:00,ok,test:ntag424-master-key\r\n`,
    ),
  });
  await page.getByRole("button", { name: "Import results" }).click();
  await expect(page.getByText("1 linked")).toBeVisible();
  await expect(page.getByRole("cell", { name: uid })).toBeVisible();

  // The admin claims it with a real-looking tap.
  const first = simulateTap(MASTER, uid, 2);
  await page.goto(`/t/${tag.tagId}?picc=${first.picc}&cmac=${first.cmac}`);
  await page.getByLabel("Claim code").fill(tag.claimCode);
  await page.getByLabel(/Lost device/).check();
  await page.getByRole("button", { name: "Activate tag" }).click();
  await expect(page).toHaveURL(/\/dashboard\?claimed=/);

  // A finder taps: genuine. The same URL again (a copy or replay): not confirmed.
  const finder = await newVisitor(browser);
  const next = simulateTap(MASTER, uid, 3);
  const tapUrl = `/t/${tag.tagId}?picc=${next.picc}&cmac=${next.cmac}`;
  await finder.goto(tapUrl);
  await expect(finder.getByText("✓ Genuine tag")).toBeVisible();
  await finder.goto(tapUrl);
  await expect(finder.locator("[data-tap=unverified]")).toBeVisible();
  await expect(finder.getByText("✓ Genuine tag")).toHaveCount(0);

  // A tap from a different chip pasted onto this tag's URL isn't genuine either.
  const other = simulateTap(MASTER, randomUid(), 9);
  await finder.goto(`/t/${tag.tagId}?picc=${other.picc}&cmac=${other.cmac}`);
  await expect(finder.locator("[data-tap=unverified]")).toBeVisible();

  // A plain link shows the page without either message.
  await finder.goto(`/t/${tag.tagId}`);
  await expect(finder.getByRole("heading", { name: "Please return this device" })).toBeVisible();
  await expect(finder.locator("[data-tap]")).toHaveCount(0);
  expect(csp).toEqual([]);
});

async function customerWithTag(browser: Browser, tag: IssuedLabel, type: RegExp, email = uniqueEmail("owner")) {
  const customer = await newVisitor(browser);
  await signUpAndVerify(customer, email);
  await customer.goto(`/t/${tag.tagId}`);
  await customer.getByLabel("Claim code").fill(tag.claimCode);
  await customer.getByLabel(type).check();
  await customer.getByRole("button", { name: "Activate tag" }).click();
  await expect(customer).toHaveURL(/\/dashboard\?claimed=/);
  return customer;
}

test("business card: edit, public page and Save contact", async ({ page, browser }) => {
  await becomeAdmin(page);
  const { labels } = await createBatch(page, 2);
  const [card, pet] = labels;
  const owner = await customerWithTag(browser, card, /Digital business card/);
  const csp = watchCsp(owner);

  await owner.getByRole("link", { name: "Edit profile" }).click();
  await owner.getByLabel("Full name").fill("Ada Lovelace");
  await owner.getByLabel("Job title").fill("Engineer");
  await owner.getByLabel("Company", { exact: true }).fill("Analytical Engines");
  await owner.getByRole("button", { name: "Add phone" }).click();
  await owner.getByLabel("Phone number 1").fill("+44 20 7946 0958");
  await owner.getByRole("button", { name: "Add email" }).click();
  await owner.getByLabel("Email address 1").fill("ada@example.com");
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(owner.getByText("Saved.")).toBeVisible();

  // A photo: a non-image is refused, a real one (with GPS data) is stored without it.
  await owner.getByLabel("Photo", { exact: true }).setInputFiles({
    name: "notes.txt",
    mimeType: "image/jpeg",
    buffer: Buffer.from("definitely not a picture"),
  });
  await owner.getByRole("button", { name: "Upload photo" }).click();
  await expect(owner.getByText("That file isn't an image we can read.")).toBeVisible();
  const photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#cc6633" } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } })
    .toBuffer();
  await owner
    .getByLabel("Photo", { exact: true })
    .setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: photo });
  await owner.getByRole("button", { name: "Upload photo" }).click();
  await expect(owner.getByText("Image updated.")).toBeVisible();
  await expect(owner.getByRole("img", { name: "Current photo" })).toBeVisible();

  const visitor = await newVisitor(browser);
  await visitor.goto(`/q/${card.publicCode}`);
  await expect(visitor.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  const img = visitor.getByRole("img", { name: "Photo of Ada Lovelace" });
  await expect(img).toBeVisible();
  const served = await visitor.request.get((await img.getAttribute("src"))!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/webp");
  const meta = await sharp(await served.body()).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.width).toBe(1024);
  await expect(visitor.getByText("Engineer · Analytical Engines")).toBeVisible();
  await expect(visitor.getByText("+44 20 7946 0958")).toBeVisible();
  await expect(visitor.getByText("This is your tag")).toHaveCount(0);

  const vcardHref = await visitor.getByRole("link", { name: "Save contact" }).getAttribute("href");
  const vcard = await visitor.request.get(vcardHref!);
  expect(vcard.headers()["content-type"]).toContain("text/vcard");
  expect(vcard.headers()["content-disposition"]).toContain("ada-lovelace.vcf");
  const body = await vcard.text();
  expect(body).toContain("FN:Ada Lovelace\r\n");
  expect(body).toContain("+44 20 7946 0958");
  expect((await visitor.request.get(`/q/${pet.publicCode}/vcard`)).status()).toBe(404);

  // The owner sees an edit shortcut on their own public page.
  await owner.goto(`/q/${card.publicCode}`);
  await expect(owner.getByRole("link", { name: "Edit profile" })).toBeVisible();
  expect(csp).toEqual([]);
});

test("lost pet: private microchip number, lost mode banner", async ({ page, browser }) => {
  await becomeAdmin(page);
  const { labels } = await createBatch(page, 1);
  const [tag] = labels;
  const owner = await customerWithTag(browser, tag, /Lost pet/);
  const csp = watchCsp(owner);

  await owner.getByRole("link", { name: "Edit profile" }).click();
  await owner.getByLabel("Pet's name").fill("Biscuit");
  await owner.getByLabel("Breed").fill("Beagle");
  await owner.getByLabel("Microchip number (private)").fill("985 112 003 456 789");
  await owner.getByLabel("Reward (optional)").fill("$100");
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(owner.getByText("Saved.")).toBeVisible();

  const finder = await newVisitor(browser);
  await finder.goto(`/q/${tag.publicCode}`);
  await expect(finder.getByRole("heading", { name: "Biscuit" })).toBeVisible();
  await expect(finder.getByText("This pet is microchipped")).toBeVisible();
  const html = await finder.content();
  expect(html).not.toContain("985112003456789");
  expect(html).not.toContain("985 112");
  await expect(finder.getByText("I found this pet")).toHaveCount(0);
  await expect(finder.getByText("$100")).toHaveCount(0);

  await owner.getByRole("button", { name: /turn lost mode on/ }).click();
  await expect(owner.getByRole("heading", { name: "Lost mode is ON" })).toBeVisible();
  await finder.reload();
  await expect(finder.getByText("I found this pet")).toBeVisible();
  await expect(finder.getByText("$100")).toBeVisible();
  expect(await finder.content()).not.toContain("985112003456789");

  await owner.getByRole("button", { name: /turn lost mode off/ }).click();
  await expect(owner.getByRole("heading", { name: "Lost mode is off" })).toBeVisible();
  expect(csp).toEqual([]);
});

test("finder messages the owner with their location; the owner gets an email and sees it", async ({
  page,
  browser,
}) => {
  await becomeAdmin(page);
  const { labels } = await createBatch(page, 1);
  const ownerEmail = uniqueEmail("petowner");
  const owner = await customerWithTag(browser, labels[0], /Lost pet/, ownerEmail);

  // The owner sees a note instead of the form on their own page.
  await owner.goto(`/q/${labels[0].publicCode}`);
  await expect(owner.getByText("Finders can message you from here")).toBeVisible();
  await expect(owner.getByRole("button", { name: "Send message" })).toHaveCount(0);

  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 51.5007292, longitude: -0.1246254 },
  });
  const finder = await context.newPage();
  const csp = watchCsp(finder);
  await finder.goto(`/q/${labels[0].publicCode}`);
  const html = await finder.content();
  expect(html).not.toContain(ownerEmail);

  await finder.getByLabel("Your message").fill("Found your dog near the bridge <3");
  await finder.getByLabel(/How can the owner reach you/).fill("555-0100");
  await finder.getByRole("button", { name: "Share my location" }).click();
  await expect(finder.getByText(/Location added/)).toBeVisible();
  await finder.getByRole("button", { name: "Send message" }).click();
  // The browser solves the bot check first (well under a second on a phone).
  await expect(finder.getByText("Your message was sent to the owner.")).toBeVisible({ timeout: 15_000 });

  const link = await latestLinkTo(ownerEmail, /found your pet/i);
  expect(link).toContain("openstreetmap.org/?mlat=51.50073&mlon=-0.12463");

  await owner.goto("/dashboard");
  await owner.getByRole("link", { name: "Edit profile" }).click();
  const list = owner.getByRole("list", { name: "Messages from finders" });
  await expect(list).toContainText("Found your dog near the bridge <3");
  await expect(list).toContainText("Contact: 555-0100");
  await expect(list.getByRole("link", { name: "Location on map" })).toBeVisible();
  expect(csp).toEqual([]);
});

test("scans of a lost item alert the owner and show in the history; the owner's own visits don't count", async ({
  page,
  browser,
}) => {
  await becomeAdmin(page);
  const { labels } = await createBatch(page, 1);
  const ownerEmail = uniqueEmail("scanowner");
  const owner = await customerWithTag(browser, labels[0], /Lost device/, ownerEmail);

  await owner.goto(`/q/${labels[0].publicCode}`);
  await owner.goto(`/dashboard/tags/${labels[0].tagId}`);
  await expect(owner.getByText("No scans yet.")).toBeVisible();

  const visitor = await newVisitor(browser);
  await visitor.goto(`/q/${labels[0].publicCode}`);
  await expect(visitor.getByRole("heading", { name: "Please return this device" })).toBeVisible();

  expect(await latestLinkTo(ownerEmail, /tag was just scanned/)).toMatch(/\/dashboard$/);
  await owner.reload();
  await expect(owner.getByRole("table", { name: "Recent scans" })).toContainText("QR code");
  await expect(owner.getByText(/Scan alerts by email are/)).toContainText("on");
  await owner.getByRole("button", { name: "Turn scan alerts off" }).click();
  await expect(owner.getByRole("button", { name: "Turn scan alerts on" })).toBeVisible();
});

test("health check reports the database is reachable", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("unknown tags and codes are a plain 404", async ({ page }) => {
  for (const path of ["/t/0000000000000000", "/t/not-a-tag", "/q/ZZZZZZZZZZ", "/q/zz"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});
