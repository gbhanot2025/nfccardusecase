"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/FormError";
import { authClient } from "@/lib/auth-client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);

    setPending(true);
    const { data, error: signInError } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
      callbackURL: next,
    });
    setPending(false);

    if (signInError) {
      if (signInError.code === "EMAIL_NOT_VERIFIED") {
        setNotice("Please verify your email first. We've sent you a new verification link.");
      } else if (signInError.status === 429) {
        setError("Too many attempts. Please wait a minute and try again.");
      } else {
        // Same message for unknown email and wrong password, so accounts can't be discovered.
        setError("Incorrect email or password.");
      }
      return;
    }
    // When 2FA is on, the client plugin redirects to /two-factor instead.
    if (data && !("twoFactorRedirect" in data && data.twoFactorRedirect)) {
      router.replace(next);
      router.refresh();
    }
  }

  async function onPasskey() {
    setError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setError("Passkey sign-in didn't work. Try again or use your password.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <FormError message={error} />
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      <label>
        Email
        <input name="email" type="email" autoComplete="email webauthn" required maxLength={254} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required maxLength={128} />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </button>
      <p className="divider">or</p>
      <button type="button" className="secondary" onClick={onPasskey}>
        Log in with a passkey
      </button>
    </form>
  );
}
