import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <main>
      <h1>Reset your password</h1>
      <p className="muted">Enter your account email and we&apos;ll send you a reset link.</p>
      <div className="card">
        <ForgotPasswordForm />
      </div>
      <p className="muted">
        <Link href="/login">Back to log in</Link>
      </p>
    </main>
  );
}
