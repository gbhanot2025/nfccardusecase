import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

/** Data-access guard: every protected page and action calls this; the proxy redirect is only a convenience. */
export async function requireUser(nextPath = "/dashboard") {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return session.user;
}

/** Admins must have two-step verification on: an admin account can mint and disable tags. */
export async function requireAdmin(nextPath = "/admin") {
  const user = await requireUser(nextPath);
  if (user.role !== "admin") redirect("/dashboard");
  if (!user.twoFactorEnabled) redirect("/dashboard/security?admin=1");
  return user;
}
