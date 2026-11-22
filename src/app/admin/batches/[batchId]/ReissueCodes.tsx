"use client";

import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { type IssueState, reissueAction } from "../../actions";
import { IssuedSheet } from "../../IssuedSheet";

/** Replaces the tag table with the one-time label sheet after new claim codes are issued. */
export function ReissueCodes({
  batchId,
  unclaimed,
  children,
}: {
  batchId: string;
  unclaimed: number;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<IssueState>(reissueAction.bind(null, batchId), {});

  if (state.issued) return <IssuedSheet issued={state.issued} />;

  return (
    <>
      <div className="card no-print">
        <h2>Lost the claim codes?</h2>
        <p className="muted">
          Give the {unclaimed} unclaimed tag{unclaimed === 1 ? "" : "s"} in this batch new claim codes. The old codes
          stop working immediately; claimed tags are not affected.
        </p>
        <form action={formAction}>
          <FormError message={state.error ?? null} />
          <button
            type="submit"
            className="danger"
            disabled={pending || unclaimed === 0}
            onClick={(e) => {
              if (!window.confirm("Replace the claim codes of every unclaimed tag in this batch?")) e.preventDefault();
            }}
          >
            {pending ? "Reissuing…" : "Reissue claim codes"}
          </button>
        </form>
      </div>
      {children}
    </>
  );
}
