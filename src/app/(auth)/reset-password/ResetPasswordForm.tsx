"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/FormError";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    if (newPassword !== String(form.get("confirm") ?? "")) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    const { error: resetError } = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (resetError) {
      setError(resetError.message ?? "This link is invalid or has expired.");
      return;
    }
    router.replace("/login?reset=1");
  }

  return (
    <form onSubmit={onSubmit}>
      <FormError message={error} />
      <label>
        New password (at least 12 characters)
        <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </label>
      <label>
        Confirm new password
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
