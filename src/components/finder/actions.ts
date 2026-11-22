"use server";

import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { finderMessageEmail, sendEmail } from "@/lib/email";
import { markDelivered, submitFinderMessage } from "@/server/relay";
import { clientIp } from "@/server/request";

export type FinderState = { status: "idle" } | { status: "sent" } | { status: "error"; message: string };

const ERRORS = {
  invalid: "Please check your message and try again.",
  not_found: "This tag can't receive messages right now.",
  bot_check: "We couldn't confirm you're not a bot. Reload the page and try again.",
  rate_limited: "Too many messages from here. Please try again later.",
} as const;

/** "Message owner" on a lost-item page. Anyone may call it, so every check lives in submitFinderMessage. */
export async function sendFinderMessageAction(
  publicCode: string,
  _prev: FinderState,
  form: FormData,
): Promise<FinderState> {
  const db = getDb();
  const result = await submitFinderMessage(db, {
    publicCode,
    ip: await clientIp(),
    raw: {
      message: form.get("message"),
      contact: form.get("contact"),
      latitude: form.get("latitude"),
      longitude: form.get("longitude"),
      altcha: form.get("altcha"),
    },
  });
  if (!result.ok) return { status: "error", message: result.message ?? ERRORS[result.error] };

  try {
    await sendEmail(finderMessageEmail({ ...result.email, dashboardUrl: `${env().APP_BASE_URL}/dashboard` }));
    await markDelivered(db, result.messageId);
  } catch {
    // The message is saved and visible in the owner's dashboard; never log its content.
    console.error("Finder message saved but the email could not be sent");
  }
  return { status: "sent" };
}
