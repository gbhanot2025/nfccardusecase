import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-android", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Tests run against a production build so the strict Content-Security-Policy is exercised.
    command: `npx next build && npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      APP_BASE_URL: baseURL,
      MAIL_OUTBOX_DIR: ".mail-outbox-e2e",
      // Tests sign up and log in repeatedly from one IP.
      AUTH_RATE_LIMIT: "off",
      // Stands in for OpenBao so tests can simulate genuine NTAG 424 taps (tests/e2e/ntag424-sim.ts).
      NTAG424_TEST_MASTER_KEY: "000102030405060708090A0B0C0D0E0F",
      // Photos go to a local folder instead of S3 (development and tests only).
      STORAGE_DIR: "./.storage-e2e",
    },
  },
});
