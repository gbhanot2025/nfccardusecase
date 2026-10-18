"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/FormError";
import { authClient } from "@/lib/auth-client";

export function TwoFactorForm() {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = form.get("trust") === "on";

    setPending(true);
    const { error: verifyError } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setPending(false);

    if (verifyError) {
      setError(
        verifyError.status === 429 ? "Too many attempts. Please wait a minute." : "That code didn't work. Try again.",
      );
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <FormError message={error} />
      <label>
        {useBackup ? "Backup code" : "6-digit code"}
        <input
          name="code"
          required
          autoComplete="one-time-code"
          inputMode={useBackup ? "text" : "numeric"}
          maxLength={useBackup ? 32 : 6}
          pattern={useBackup ? undefined : "[0-9]{6}"}
        />
      </label>
      <label className="row">
        <input type="checkbox" name="trust" /> Trust this device for 30 days
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Verify"}
      </button>
      <button type="button" className="secondary" onClick={() => setUseBackup((v) => !v)}>
        {useBackup ? "Use authenticator code" : "Use a backup code"}
      </button>
    </form>
  );
}
