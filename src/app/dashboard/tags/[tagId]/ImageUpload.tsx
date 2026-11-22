"use client";

import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import type { ImageState } from "./image-actions";

export function ImageUpload({
  label,
  currentUrl,
  upload,
  remove,
}: {
  label: string;
  currentUrl: string | undefined;
  upload: (prev: ImageState, form: FormData) => Promise<ImageState>;
  remove: () => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(upload, { status: "idle" } as ImageState);
  return (
    <div className="image-upload">
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- next/image adds inline styles the CSP forbids
        <img className="image-preview" src={currentUrl} alt={`Current ${label.toLowerCase()}`} />
      ) : (
        <p className="muted">No {label.toLowerCase()} yet.</p>
      )}
      <form action={formAction}>
        <FormError message={state.status === "error" ? (state.message ?? null) : null} />
        {state.status === "saved" && (
          <p className="alert success" role="status">
            {state.message}
          </p>
        )}
        <label>
          {label}
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required />
        </label>
        <p className="muted">
          JPEG, PNG, WebP or HEIC, up to 8 MB. Hidden location data (GPS) is removed from photos automatically.
        </p>
        <div className="row">
          <button type="submit" className="secondary" disabled={pending}>
            {pending ? "Uploading…" : `Upload ${label.toLowerCase()}`}
          </button>
        </div>
      </form>
      {currentUrl && (
        <form action={remove} className="inline">
          <button type="submit" className="secondary small">
            Remove {label.toLowerCase()}
          </button>
        </form>
      )}
    </div>
  );
}
