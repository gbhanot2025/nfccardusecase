"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { FormError } from "@/components/FormError";
import type { FinderState } from "./actions";

export type Challenge = { algorithm: "SHA-256"; challenge: string; maxnumber: number; salt: string; signature: string };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Find the number behind the challenge (ALTCHA proof of work) and encode the payload the server expects. */
async function solve(c: Challenge): Promise<string | null> {
  // Hash in batches: one await per batch instead of per number is several times faster on phones.
  const BATCH = 500;
  for (let start = 0; start <= c.maxnumber; start += BATCH) {
    const numbers = Array.from({ length: Math.min(BATCH, c.maxnumber - start + 1) }, (_, i) => start + i);
    const hashes = await Promise.all(numbers.map((n) => sha256Hex(c.salt + n)));
    const found = hashes.indexOf(c.challenge);
    if (found !== -1) {
      const payload = {
        algorithm: c.algorithm,
        challenge: c.challenge,
        number: numbers[found],
        salt: c.salt,
        signature: c.signature,
      };
      return btoa(JSON.stringify(payload));
    }
  }
  return null;
}

type Location = { latitude: number; longitude: number; accuracy: number };

export function FinderMessageForm({
  action,
  challenge,
}: {
  action: (prev: FinderState, form: FormData) => Promise<FinderState>;
  challenge: Challenge;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as FinderState);
  const [location, setLocation] = useState<Location | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [solving, setSolving] = useState(false);
  const solution = useRef<Promise<string | null> | null>(null);

  // Start the bot check in the background as soon as the page loads, so sending feels instant.
  useEffect(() => {
    solution.current = solve(challenge);
  }, [challenge]);

  if (state.status === "sent") {
    return (
      <p className="alert success" role="status">
        Thank you! Your message was sent to the owner.
      </p>
    );
  }

  function shareLocation() {
    setLocationError(null);
    if (!("geolocation" in navigator)) {
      setLocationError("Your browser can't share a location.");
      return;
    }
    setLocating(true);
    // Only runs after the finder presses the button; the browser then asks for permission.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      () => {
        setLocating(false);
        setLocationError("Location wasn't shared. You can still send your message.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSolving(true);
    solution.current ??= solve(challenge);
    const payload = await solution.current;
    setSolving(false);
    form.set("altcha", payload ?? "");
    if (location) {
      form.set("latitude", String(location.latitude));
      form.set("longitude", String(location.longitude));
    }
    startTransition(() => formAction(form));
  }

  const busy = pending || solving;
  return (
    <form onSubmit={onSubmit} className="finder-form">
      <h2>Message the owner</h2>
      <FormError message={state.status === "error" ? state.message : null} />
      <label>
        Your message
        <textarea name="message" required maxLength={2000} rows={4} placeholder="Where and when you found it…" />
      </label>
      <label>
        How can the owner reach you? (optional)
        <input name="contact" maxLength={200} autoComplete="off" placeholder="Phone or email" />
      </label>
      <div className="row">
        {location ? (
          <>
            <span className="muted" role="status">
              Location added (±{Math.round(location.accuracy)} m)
            </span>
            <button type="button" className="secondary small" onClick={() => setLocation(null)}>
              Remove location
            </button>
          </>
        ) : (
          <button type="button" className="secondary" onClick={shareLocation} disabled={locating}>
            {locating ? "Getting location…" : "Share my location"}
          </button>
        )}
      </div>
      {locationError && <p className="muted">{locationError}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
