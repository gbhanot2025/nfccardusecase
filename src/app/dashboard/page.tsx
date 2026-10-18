import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { requireUser } from "@/lib/require-user";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");

  return (
    <main className="wide">
      <div className="row between">
        <div>
          <h1>Your tags</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
        <div className="row">
          <Link className="button secondary" href="/dashboard/security">
            Security
          </Link>
          <SignOutButton />
        </div>
      </div>

      {!user.twoFactorEnabled && (
        <p className="alert success" role="status">
          Protect your account: <Link href="/dashboard/security">turn on two-step verification or add a passkey</Link>.
        </p>
      )}

      <div className="card">
        <h2>No tags yet</h2>
        <p className="muted">
          Tap your new tag with your phone and enter the claim code from the packaging to link it to this account.
        </p>
      </div>
    </main>
  );
}
