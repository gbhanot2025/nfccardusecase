import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  const invalid = params.error === "INVALID_TOKEN" || !token;

  return (
    <main>
      <h1>Choose a new password</h1>
      <div className="card">
        {invalid ? (
          <p className="alert error" role="alert">
            This reset link is invalid or has expired. <Link href="/forgot-password">Request a new one</Link>.
          </p>
        ) : (
          <ResetPasswordForm token={token} />
        )}
      </div>
    </main>
  );
}
