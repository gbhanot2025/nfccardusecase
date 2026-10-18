import { z } from "zod";

/**
 * Server-side environment, validated once at startup (see src/instrumentation.ts).
 * A missing or malformed value fails loudly instead of surfacing later as a bug.
 */
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), z.url().optional());
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_NAME: z.string().min(1).default("Tag Platform"),
    APP_BASE_URL: z.url().refine((u) => !u.endsWith("/"), "APP_BASE_URL must not end with /"),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    // Comma-separated IPs/CIDRs of the reverse proxy (Caddy) so client IPs are read correctly.
    TRUSTED_PROXIES: z
      .string()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    // Rate limiting is always on except in automated tests.
    AUTH_RATE_LIMIT: z.enum(["on", "off"]).default("on"),

    // Email: SMTP in real environments; a file outbox is allowed only outside production.
    SMTP_URL: optionalUrl,
    MAIL_FROM: z.string().min(3).default("Tag Platform <no-reply@localhost>"),
    MAIL_OUTBOX_DIR: optionalString,

    // Object storage (used from milestone 4).
    S3_ENDPOINT: optionalUrl,
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY: optionalString,
    S3_SECRET_KEY: optionalString,

    // Secrets vault (used from milestone 3).
    OPENBAO_ADDR: optionalUrl,
    OPENBAO_TOKEN: optionalString,
  })
  .superRefine((env, ctx) => {
    // A production build served on localhost (e.g. the e2e test run) can't be a real deployment,
    // so the deployment-only rules below are skipped for it.
    const localOnly = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.APP_BASE_URL).hostname);
    if (env.NODE_ENV === "production" && !localOnly) {
      if (!env.SMTP_URL) {
        ctx.addIssue({ code: "custom", path: ["SMTP_URL"], message: "SMTP_URL is required in production" });
      }
      if (env.MAIL_OUTBOX_DIR) {
        ctx.addIssue({
          code: "custom",
          path: ["MAIL_OUTBOX_DIR"],
          message: "The file outbox is for development and tests only",
        });
      }
      if (env.AUTH_RATE_LIMIT === "off") {
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_RATE_LIMIT"],
          message: "Rate limiting cannot be off in production",
        });
      }
      if (!env.APP_BASE_URL.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: ["APP_BASE_URL"], message: "APP_BASE_URL must use https in production" });
      }
    } else if (!env.SMTP_URL && !env.MAIL_OUTBOX_DIR) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_URL"],
        message: "Set SMTP_URL (e.g. Mailpit) or MAIL_OUTBOX_DIR for local email",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parse an env object; error messages name the variables but never print their values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
