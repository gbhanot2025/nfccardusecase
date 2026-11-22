import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { getAuth } from "@/lib/auth";
import { requireUser } from "@/lib/require-user";
import { type PasskeyItem, PasskeySettings } from "./PasskeySettings";
import { TwoFactorSettings } from "./TwoFactorSettings";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: PageProps<"/dashboard/security">) {
  const user = await requireUser("/dashboard/security");
  const adminNeeds2fa = (await searchParams).admin === "1" && !user.twoFactorEnabled;
  const rows = await getAuth().api.listPasskeys({ headers: await headers() });
  const passkeys: PasskeyItem[] = rows.map((p) => ({
    id: p.id,
    name: p.name ?? null,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
  }));

  return (
    <main className="wide">
      <p>
        <Link href="/dashboard">← Back to your tags</Link>
      </p>
      <h1>Security</h1>
      {adminNeeds2fa && (
        <p className="alert error" role="alert">
          Turn on two-step verification to use the admin area.
        </p>
      )}
      <div className="card">
        <TwoFactorSettings enabled={Boolean(user.twoFactorEnabled)} />
      </div>
      <div className="card">
        <PasskeySettings passkeys={passkeys} />
      </div>
    </main>
  );
}
