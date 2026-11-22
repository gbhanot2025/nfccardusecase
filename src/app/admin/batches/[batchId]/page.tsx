import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/require-user";
import { FORM_FACTOR_LABEL, PROFILE_TYPE_INFO } from "@/profile-types/registry";
import { getBatch } from "@/server/batches";
import { AdminTagActions, StatusBadge } from "../../TagBits";
import { ReissueCodes } from "./ReissueCodes";

export const metadata: Metadata = { title: "Batch" };

export default async function BatchPage({ params }: PageProps<"/admin/batches/[batchId]">) {
  const { batchId } = await params;
  await requireAdmin(`/admin/batches/${encodeURIComponent(batchId)}`);
  const detail = /^b_[0-9a-z]{12}$/.test(batchId) ? await getBatch(getDb(), batchId) : null;
  if (!detail) notFound();
  const { batch, tags, unclaimed } = detail;

  return (
    <main className="full">
      <div className="no-print">
        <p>
          <Link href="/admin">← Admin</Link>
        </p>
        <h1>{batch.label}</h1>
        <p className="muted">
          <span className="mono">{batch.id}</span> · {FORM_FACTOR_LABEL[batch.formFactor]} · {batch.quantity} tags ·
          created {batch.createdAt.toISOString().slice(0, 10)}
          <br />
          Allowed profiles: {batch.allowedTypes.map((t) => PROFILE_TYPE_INFO[t].label).join(", ")}
        </p>
        <div className="row">
          <Link className="button secondary" href={`/admin/batches/${batch.id}/qr`}>
            Print QR sheet (no claim codes)
          </Link>
        </div>
      </div>

      <ReissueCodes batchId={batch.id} unclaimed={unclaimed}>
        <div className="card">
          <h2>Tags</h2>
          <table>
            <thead>
              <tr>
                <th>Tag ID</th>
                <th>Public code</th>
                <th>Status</th>
                <th>Claimed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tags.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.id}</td>
                  <td className="mono">{t.publicCode}</td>
                  <td>
                    <StatusBadge status={t.status} reason={t.disabledReason} />
                  </td>
                  <td>{t.claimedAt ? t.claimedAt.toISOString().slice(0, 10) : "—"}</td>
                  <td>
                    <AdminTagActions tagId={t.id} status={t.status} reason={t.disabledReason} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReissueCodes>
    </main>
  );
}
