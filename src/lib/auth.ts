import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth-config";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { existingAccountEmail, resetPasswordEmail, sendEmail, verificationEmail } from "@/lib/email";
import { env } from "@/lib/env";

function createAuth() {
  const config = env();
  const options = authOptions(config, {
    sendVerification: (to, url) => sendEmail(verificationEmail(to, url)),
    sendReset: (to, url) => sendEmail(resetPasswordEmail(to, url)),
    sendExistingAccount: (to) => sendEmail(existingAccountEmail(to, `${config.APP_BASE_URL}/login`)),
  });

  return betterAuth({
    ...options,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    // nextCookies must be last so cookies set by server actions reach the browser.
    plugins: [...options.plugins, nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { auth?: Auth };

/** Created on first request, so `next build` never needs runtime secrets. */
export function getAuth(): Auth {
  globalForAuth.auth ??= createAuth();
  return globalForAuth.auth;
}

export type Session = Auth["$Infer"]["Session"];

/** Current session or null. Always verified against the database, never trusted from the cookie alone. */
export async function getSession(): Promise<Session | null> {
  return getAuth().api.getSession({ headers: await headers() });
}
