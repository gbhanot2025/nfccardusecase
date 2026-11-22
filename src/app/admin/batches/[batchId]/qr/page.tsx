import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LabelSheet } from "@/components/LabelSheet";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/require-user";
import { getBatch } from "@/server/batches";
import { qrSvg, qrUrl } from "@/server/links";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = { title: "QR sheet" };

/** QR-only labels for a batch, available any time (claim codes can't be shown again). */
export default async function BatchQrPage({ params }: PageProps<"/admin/batches/[batchId]/qr">) {
  const { batchId } = await params;
  await requireAdmin(`/admin/batches/${encodeURIComponent(batchId)}/qr`);
  const detail = /^b_[0-9a-z]{12}$/.test(batchId) ? await getBatch(getDb(), batchId) : null;
  if (!detail) notFound();

  const base = env().APP_BASE_URL;
  const labels = await Promise.all(
    detail.tags.map(async (t) => ({
      tagId: t.id,
      publicCode: t.publicCode,
      qrSvg: await qrSvg(qrUrl(base, t.publicCode)),
    })),
  );

  return (
    <main className="full">
      <div className="no-print">
        <p>
          <Link href={`/admin/batches/${detail.batch.id}`}>← {detail.batch.label}</Link>
        </p>
        <h1>QR sheet</h1>
        <p className="muted">
          QR codes only. Claim codes are shown once when a batch is created or its codes reissued.
        </p>
        <PrintButton />
      </div>
      <LabelSheet labels={labels} />
    </main>
  );
}
