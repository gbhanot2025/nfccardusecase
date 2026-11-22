"use client";

import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { FORM_FACTOR_LABEL, FORM_FACTORS, PROFILE_TYPE_INFO, PROFILE_TYPES } from "@/profile-types/registry";
import { createBatchAction, type IssueState } from "../../actions";
import { IssuedSheet } from "../../IssuedSheet";

export function CreateBatchForm({ maxSize }: { maxSize: number }) {
  const [state, formAction, pending] = useActionState<IssueState, FormData>(createBatchAction, {});

  if (state.issued) return <IssuedSheet issued={state.issued} />;

  return (
    <div className="card">
      <form action={formAction}>
        <FormError message={state.error ?? null} />
        <label>
          Batch name
          <input name="label" required maxLength={100} placeholder="e.g. Pilot cards, Nov 2026" />
        </label>
        <label>
          Form factor
          <select name="formFactor" required defaultValue="card">
            {FORM_FACTORS.map((f) => (
              <option key={f} value={f}>
                {FORM_FACTOR_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Profile types customers may choose</legend>
          {PROFILE_TYPES.map((t) => (
            <label className="check" key={t}>
              <input type="checkbox" name="allowedTypes" value={t} defaultChecked />
              <span>{PROFILE_TYPE_INFO[t].label}</span>
            </label>
          ))}
        </fieldset>
        <label>
          Number of tags (1–{maxSize})
          <input name="quantity" type="number" min={1} max={maxSize} required defaultValue={10} />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Generating…" : "Generate batch"}
        </button>
      </form>
    </div>
  );
}
