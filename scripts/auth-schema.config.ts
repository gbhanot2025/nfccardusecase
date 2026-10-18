// Used only by `npm run auth:schema` to regenerate src/lib/db/schema/auth.ts.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { authOptions } from "../src/lib/auth-config";
import { parseEnv } from "../src/lib/env";

const config = parseEnv({
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://unused@localhost/unused",
  BETTER_AUTH_SECRET: "schema-generation-only-secret-000000000000",
  MAIL_OUTBOX_DIR: "/tmp/unused",
});
const noop = async () => {};

export const auth = betterAuth({
  ...authOptions(config, { sendVerification: noop, sendReset: noop, sendExistingAccount: noop }),
  database: drizzleAdapter({}, { provider: "pg" }),
});
