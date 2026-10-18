import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { getAuth } from "@/lib/auth";
import { requireUser } from "@/lib/require-user";
import { type PasskeyItem, PasskeySettings } from "./PasskeySettings";
import { TwoFactorSettings } from "./TwoFactorSettings";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const user = await requireUser("/dashboard/security");
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
      <div className="card">
        <TwoFactorSettings enabled={Boolean(user.twoFactorEnabled)} />
      </div>
      <div className="card">
        <PasskeySettings passkeys={passkeys} />
      </div>
    </main>
  );
}
