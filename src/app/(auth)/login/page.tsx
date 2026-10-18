import type { Metadata } from "next";
import Link from "next/link";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const reset = params.reset === "1";

  return (
    <main>
      <h1>Log in</h1>
      {reset && (
        <p className="alert success" role="status">
          Your password was changed. Log in with your new password.
        </p>
      )}
      <div className="card">
        <LoginForm next={next} />
      </div>
      <p className="muted">
        <Link href="/forgot-password">Forgot password?</Link> · No account? <Link href="/signup">Create one</Link>
      </p>
    </main>
  );
}
