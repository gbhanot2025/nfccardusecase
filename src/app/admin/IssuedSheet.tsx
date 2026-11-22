"use client";

import Link from "next/link";
import { LabelSheet } from "@/components/LabelSheet";
import type { IssuedBatch } from "./actions";

const CSV_COLUMNS = ["batch_id", "tag_id", "public_code", "nfc_url", "qr_url", "claim_code"] as const;

/** Every value is our own generated code or URL, but quote anyway so the CSV is always well-formed. */
function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function toCsv(issued: IssuedBatch): string {
  const rows = issued.labels.map((l) =>
    [issued.batchId, l.tagId, l.publicCode, l.nfcUrl, l.qrUrl, l.claimCode].map(csvCell).join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/** Shown once, right after codes are issued: claim codes exist only here, never in the database. */
export function IssuedSheet({ issued }: { issued: IssuedBatch }) {
  function downloadCsv() {
    const blob = new Blob([toCsv(issued)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${issued.batchId}-claim-codes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="no-print">
        <p className="alert error" role="alert">
          <strong>Save these claim codes now.</strong> They are shown only once and can&apos;t be looked up later.
          Download the CSV and/or print the labels before leaving this page. If they&apos;re lost, reissue new codes
          from the batch page.
        </p>
        <div className="row">
          <button type="button" onClick={downloadCsv}>
            Download CSV
          </button>
          <button type="button" className="secondary" onClick={() => window.print()}>
            Print labels
          </button>
          <Link className="button secondary" href={`/admin/batches/${issued.batchId}`}>
            Go to batch
          </Link>
        </div>
        <p className="muted">
          {issued.label}: {issued.labels.length} tag{issued.labels.length === 1 ? "" : "s"} with claim codes.
        </p>
      </div>
      <LabelSheet labels={issued.labels} />
    </>
  );
}
