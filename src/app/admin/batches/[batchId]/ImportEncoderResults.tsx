"use client";

import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { type ImportState, importEncoderResultsAction } from "../../actions";

export function ImportEncoderResults({ batchId, encoded, total }: { batchId: string; encoded: number; total: number }) {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(
    importEncoderResultsAction.bind(null, batchId),
    {},
  );
  const r = state.result;

  return (
    <div className="card no-print">
      <h2>Encoder results</h2>
      <p className="muted">
        {encoded} of {total} tags linked to a chip. After encoding, upload the encoder&apos;s results CSV so taps can be
        verified against each chip.
      </p>
      <form action={formAction}>
        <FormError message={state.error ?? null} />
        {r && (
          <p className={`alert ${r.errors.length ? "error" : "success"}`} role="status">
            {r.updated} linked, {r.unchanged} already linked, {r.skipped} skipped (not encoded OK).
            {r.errors.length > 0 && ` ${r.errors.length} problem(s): ${r.errors.slice(0, 5).join("; ")}`}
          </p>
        )}
        <label>
          Results CSV
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <button type="submit" className="secondary" disabled={pending}>
          {pending ? "Importing…" : "Import results"}
        </button>
      </form>
    </div>
  );
}
