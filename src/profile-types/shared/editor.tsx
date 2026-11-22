"use client";

import { startTransition, useActionState, useId, useState, type FormEvent, type ReactNode } from "react";
import { FormError } from "@/components/FormError";
import "../profile-pages.css";
import type { ValidationResult } from "./fields";
import { INITIAL_EDITOR_STATE, type EditorAction, type EditorState } from "./types";

type FieldErrors = Record<string, string>;

/** Positions (row numbers in the form) of the list rows that were filled in, by list prefix. */
type RowPositions = Record<string, number[]>;

function filledRowPositions(form: FormData, lists: readonly ListSpec[]): RowPositions {
  const out: RowPositions = {};
  for (const { prefix, required } of lists) {
    const positions: number[] = [];
    for (let i = 0; i < 50; i++) {
      const value = form.get(`${prefix}.${i}.${required}`);
      if (typeof value === "string" && value.trim() !== "") positions.push(i);
    }
    out[prefix] = positions;
  }
  return out;
}

/**
 * The schema reports list errors by item index (empty rows are skipped), the form names rows by
 * position. Translate `phones.1.number` to the form row it came from.
 */
function toFormPaths(errors: FieldErrors | undefined, positions: RowPositions): FieldErrors {
  const out: FieldErrors = {};
  for (const [path, message] of Object.entries(errors ?? {})) {
    const [prefix, index, ...rest] = path.split(".");
    const rows = positions[prefix];
    if (rows && index !== undefined && /^\d+$/.test(index)) {
      out[[prefix, String(rows[Number(index)] ?? index), ...rest].join(".")] = message;
    } else {
      out[path] = message;
    }
  }
  return out;
}

export interface ListSpec {
  prefix: string;
  required: string;
}

/**
 * Shared editor wiring: validates on the client with the same schema the server uses (for fast
 * feedback only; the server action is the authority), then submits to the server action.
 * Submitting through `startTransition` instead of `<form action>` stops React from resetting the
 * form to stale default values after a save.
 */
export function useProfileEditor<T>({
  action,
  fromFormData,
  validate,
  lists = [],
}: {
  action: EditorAction;
  fromFormData: (form: FormData) => unknown;
  validate: (raw: unknown) => ValidationResult<T>;
  lists?: readonly ListSpec[];
}) {
  const [state, dispatch, pending] = useActionState<EditorState, FormData>(action, INITIAL_EDITOR_STATE);
  const [clientErrors, setClientErrors] = useState<FieldErrors | null>(null);
  const [clientFormError, setClientFormError] = useState<string | null>(null);
  const [positions, setPositions] = useState<RowPositions>({});

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const filled = filledRowPositions(form, lists);
    setPositions(filled);
    const result = validate(fromFormData(form));
    if (!result.success) {
      setClientErrors(toFormPaths(result.fieldErrors, filled));
      setClientFormError(result.formError ?? "Please fix the highlighted fields.");
      return;
    }
    setClientErrors(null);
    setClientFormError(null);
    startTransition(() => dispatch(form));
  }

  const serverErrors = state.status === "error" ? toFormPaths(state.fieldErrors, positions) : {};
  const errors = clientErrors ?? serverErrors;
  const formError =
    clientFormError ?? (state.status === "error" ? (state.message ?? "Could not save. Please try again.") : null);
  const savedMessage = !clientErrors && state.status === "saved" ? (state.message ?? "Saved.") : null;

  return { onSubmit, pending, errors, formError, savedMessage };
}

/** Form wrapper with status messages and the submit button. */
export function EditorForm({
  onSubmit,
  pending,
  formError,
  savedMessage,
  children,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  formError: string | null;
  savedMessage: string | null;
  children: ReactNode;
}) {
  return (
    <form className="pp-editor" onSubmit={onSubmit} noValidate>
      <FormError message={formError} />
      {savedMessage && (
        <p className="alert success" role="status">
          {savedMessage}
        </p>
      )}
      {children}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

type InputKind = "text" | "tel" | "email" | "url" | "textarea";

/** A labelled input with hint and error wired up via aria-describedby (tests find it with getByLabel). */
export function TextField({
  label,
  name,
  defaultValue,
  maxLength,
  kind = "text",
  hint,
  error,
  autoComplete,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  maxLength: number;
  kind?: InputKind;
  hint?: string;
  error?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    name,
    defaultValue: defaultValue ?? "",
    maxLength,
    autoComplete: autoComplete ?? "off",
    placeholder,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };
  return (
    <div className="pp-field">
      <label htmlFor={id}>{label}</label>
      {kind === "textarea" ? (
        <textarea {...common} rows={4} />
      ) : (
        <input
          {...common}
          type={kind}
          inputMode={kind === "tel" ? "tel" : kind === "email" ? "email" : kind === "url" ? "url" : undefined}
        />
      )}
      {hint && (
        <span id={hintId} className="pp-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="pp-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

export function SelectField({
  label,
  name,
  defaultValue,
  options,
  error,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: readonly { value: string; label: string }[];
  error?: string;
}) {
  const id = useId();
  return (
    <div className="pp-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <span id={`${id}-error`} className="pp-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/** Rows with stable keys for add/remove; uncontrolled inputs keep their values across re-renders. */
export function useRows<T>(initial: readonly T[] | undefined, max: number) {
  const [state, setState] = useState(() => {
    const rows = (initial ?? []).slice(0, max).map((value, key) => ({ key, value: value as T | undefined }));
    return { rows, nextKey: rows.length };
  });
  return {
    rows: state.rows,
    canAdd: state.rows.length < max,
    add: () =>
      setState((s) =>
        s.rows.length < max ? { rows: [...s.rows, { key: s.nextKey, value: undefined }], nextKey: s.nextKey + 1 } : s,
      ),
    remove: (key: number) => setState((s) => ({ ...s, rows: s.rows.filter((row) => row.key !== key) })),
  };
}
