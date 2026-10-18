"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/FormError";
import { authClient } from "@/lib/auth-client";

export type PasskeyItem = { id: string; name: string | null; createdAt: string | null };

export function PasskeySettings({ passkeys }: { passkeys: PasskeyItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function add() {
    setError(null);
    setPending(true);
    const result = await authClient.passkey.addPasskey({ name: deviceLabel() });
    setPending(false);
    if (result?.error) {
      setError("Couldn't add a passkey. Your browser or device may not support it, or the prompt was cancelled.");
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const { error: deleteError } = await authClient.passkey.deletePasskey({ id });
    if (deleteError) {
      setError("Couldn't remove that passkey.");
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <h2>Passkeys</h2>
      <p className="muted">Log in with your fingerprint, face or device PIN instead of a password.</p>
      <FormError message={error} />
      {passkeys.length > 0 && (
        <ul className="plain">
          {passkeys.map((p) => (
            <li key={p.id}>
              <span>
                {p.name || "Passkey"}
                {p.createdAt && <span className="muted"> · added {new Date(p.createdAt).toLocaleDateString()}</span>}
              </span>
              <button type="button" className="danger" onClick={() => remove(p.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p>
        <button type="button" onClick={add} disabled={pending}>
          {pending ? "Waiting for your device…" : "Add a passkey"}
        </button>
      </p>
    </section>
  );
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone/iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "This device";
}
