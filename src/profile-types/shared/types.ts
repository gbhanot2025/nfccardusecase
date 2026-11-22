import type { ReactNode } from "react";

/**
 * Props every profile type's `PublicPage` accepts, so `/t/{id}` and `/q/{code}` can render any type
 * the same way. Each type ignores the props it doesn't use.
 */
export interface PublicPageProps<T> {
  /** Parsed profile data (from the type's `parse` helper, never raw JSON). */
  data: T;
  /** `profiles.lost_mode`; only lost-item types use it. */
  lostMode?: boolean;
  /** Same-origin path or https URL of the photo, resolved by the route from `photoKey` (milestone 4). */
  photoUrl?: string;
  /** Same as `photoUrl`, for the business card logo. */
  logoUrl?: string;
  /** Business card only: URL of the vCard download ("Save contact"). */
  vcardUrl?: string;
  /** Lost-item types only: slot for the "Message owner" / "Share location" actions (milestone 4). */
  children?: ReactNode;
}

/** State returned by an editor's server action (used with `useActionState`). */
export type EditorState =
  | { status: "idle" }
  | { status: "saved"; message?: string }
  | { status: "error"; message?: string; fieldErrors?: Record<string, string> };

/**
 * The server action an editor posts to. It must authenticate, authorise (tag owner), map the form with
 * the type's `fromFormData`, validate with the type's schema and only then write `profiles.data`.
 */
export type EditorAction = (previous: EditorState, form: FormData) => Promise<EditorState>;

export interface EditorProps<T> {
  /** Server action (named `action` so Next's TS plugin accepts a function prop on a Client Component). */
  action: EditorAction;
  /** Current parsed data used as the form's default values. */
  initialData: T;
}

export const INITIAL_EDITOR_STATE: EditorState = { status: "idle" };
