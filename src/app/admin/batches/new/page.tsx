import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-user";
import { MAX_BATCH_SIZE } from "@/server/batches";
import { CreateBatchForm } from "./CreateBatchForm";

export const metadata: Metadata = { title: "New batch" };

export default async function NewBatchPage() {
  await requireAdmin("/admin/batches/new");
  return (
    <main className="full">
      <div className="no-print">
        <p>
          <Link href="/admin">← Admin</Link>
        </p>
        <h1>New tag batch</h1>
        <p className="muted">
          Creates unclaimed tags with random IDs, QR codes and claim codes. Claim codes are shown once, right after you
          generate the batch.
        </p>
      </div>
      <CreateBatchForm maxSize={MAX_BATCH_SIZE} />
    </main>
  );
}
