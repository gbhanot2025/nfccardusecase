"use client";

import { useState } from "react";
import { FormError } from "@/components/FormError";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    const { error: requestError } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (requestError?.status === 429) {
      setError("Too many requests. Please wait a few minutes.");
      return;
    }
    // Same message whether or not the account exists.
    setDone(true);
  }

  if (done) {
    return (
      <p className="alert success" role="status">
        If an account exists for that email, a reset link is on its way. It expires in 1 hour.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <FormError message={error} />
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required maxLength={254} />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
