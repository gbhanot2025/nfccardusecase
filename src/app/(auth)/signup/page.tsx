import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <main>
      <h1>Create your account</h1>
      <p className="muted">You&apos;ll use this account to activate and manage your tags.</p>
      <div className="card">
        <SignupForm />
      </div>
      <p className="muted">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
