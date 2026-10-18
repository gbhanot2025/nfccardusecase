"use client";

import QRCode from "qrcode";
import { useState } from "react";
import { FormError } from "@/components/FormError";
import { authClient } from "@/lib/auth-client";

type Setup = { qr: string; secret: string; backupCodes: string[] };

export function TwoFactorSettings({ enabled: initiallyEnabled }: { enabled: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [savedCodes, setSavedCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    const { data, error: enableError } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (enableError || !data || data.method !== "totp") {
      setError("Couldn't start setup. Check your password and try again.");
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({
      qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }),
      secret,
      backupCodes: data.backupCodes,
    });
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setPending(true);
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (verifyError) {
      setError("That code didn't match. Check your authenticator app's clock and try again.");
      return;
    }
    setSavedCodes(setup?.backupCodes ?? null);
    setSetup(null);
    setEnabled(true);
  }

  async function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    const { error: disableError } = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (disableError) {
      setError("Couldn't turn it off. Check your password.");
      return;
    }
    setEnabled(false);
    setSavedCodes(null);
  }

  return (
    <section>
      <h2>Two-step verification</h2>
      <FormError message={error} />

      {savedCodes && (
        <div className="alert success" role="status">
          <p>
            Two-step verification is on. Save these backup codes somewhere safe; each works once if you lose your phone.
            They won&apos;t be shown again.
          </p>
          <div className="codes">
            {savedCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {!enabled && !setup && (
        <form onSubmit={start}>
          <p className="muted">Use an authenticator app (like Aegis, 2FAS or Google Authenticator) for login codes.</p>
          <label>
            Confirm your password
            <input name="password" type="password" autoComplete="current-password" required maxLength={128} />
          </label>
          <button type="submit" disabled={pending}>
            Set up two-step verification
          </button>
        </form>
      )}

      {setup && (
        <form onSubmit={confirm}>
          <p>Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated locally */}
          <img className="qr" src={setup.qr} alt="QR code for your authenticator app" />
          <p className="muted">
            Can&apos;t scan? Enter this key manually: <code>{setup.secret}</code>
          </p>
          <label>
            6-digit code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
          <button type="submit" disabled={pending}>
            Confirm and turn on
          </button>
        </form>
      )}

      {enabled && (
        <form onSubmit={disable}>
          <p className="muted">Two-step verification is on for your account.</p>
          <label>
            Password (to turn it off)
            <input name="password" type="password" autoComplete="current-password" required maxLength={128} />
          </label>
          <button type="submit" className="danger" disabled={pending}>
            Turn off two-step verification
          </button>
        </form>
      )}
    </section>
  );
}
