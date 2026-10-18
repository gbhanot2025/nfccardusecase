import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import type { Env } from "@/lib/env";

/**
 * Better Auth options shared by the app and the schema generator.
 * Email sending is injected so this file has no side effects and can be imported anywhere.
 */
export function authOptions(
  config: Env,
  mail: {
    sendVerification: (to: string, url: string) => Promise<void>;
    sendReset: (to: string, url: string) => Promise<void>;
    sendExistingAccount: (to: string) => Promise<void>;
  },
) {
  const baseUrl = new URL(config.APP_BASE_URL);

  return {
    appName: config.APP_NAME,
    baseURL: config.APP_BASE_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_BASE_URL],

    user: {
      additionalFields: {
        // Only the database or an admin action may set this; never user input.
        role: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => mail.sendReset(user.email, url),
      // Tell the real owner instead of revealing to the requester that the account exists.
      onExistingUserSignUp: async ({ user }) => mail.sendExistingAccount(user.email),
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => mail.sendVerification(user.email, url),
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh daily while active
      freshAge: 60 * 15, // sensitive actions need a login within 15 minutes
    },

    rateLimit: {
      enabled: config.AUTH_RATE_LIMIT === "on",
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },

    advanced: {
      useSecureCookies: baseUrl.protocol === "https:",
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
        ...(config.TRUSTED_PROXIES.length > 0 ? { trustedProxies: config.TRUSTED_PROXIES } : {}),
      },
    },

    plugins: [
      twoFactor({ issuer: config.APP_NAME }),
      passkey({
        rpID: baseUrl.hostname,
        rpName: config.APP_NAME,
        origin: config.APP_BASE_URL,
      }),
    ],
  } satisfies BetterAuthOptions;
}
