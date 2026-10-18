"use client";

import { useState } from "react";
import { FormError } from "@/components/FormError";
import { authClient } from "@/lib/auth-client";

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setPending(true);
    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: "/dashboard",
    });
    setPending(false);

    if (signUpError) {
      setError(signUpError.message ?? "Could not create the account. Please try again.");
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="alert success" role="status">
        Check your inbox: we sent a verification link to <strong>{sentTo}</strong>. Open it to finish creating your
        account.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate={false}>
      <FormError message={error} />
      <label>
        Full name
        <input name="name" autoComplete="name" required maxLength={100} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required maxLength={254} />
      </label>
      <label>
        Password (at least 12 characters)
        <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </label>
      <label>
        Confirm password
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
