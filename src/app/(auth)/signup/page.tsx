import type { Metadata } from "next";
import Link from "next/link";
import { safeNextPath } from "@/lib/safe-redirect";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  return (
    <main>
      <h1>Create your account</h1>
      <p className="muted">You&apos;ll use this account to activate and manage your tags.</p>
      <div className="card">
        <SignupForm next={next} />
      </div>
      <p className="muted">
        Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Log in</Link>
      </p>
    </main>
  );
}
