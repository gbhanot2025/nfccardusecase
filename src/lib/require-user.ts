import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

/** Data-access guard: every protected page and action calls this; the proxy redirect is only a convenience. */
export async function requireUser(nextPath = "/dashboard") {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return session.user;
}

export async function requireAdmin() {
  const user = await requireUser("/admin");
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}
