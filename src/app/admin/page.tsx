import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/require-user";
import { FORM_FACTOR_LABEL, PROFILE_TYPE_INFO } from "@/profile-types/registry";
import { listBatches } from "@/server/batches";
import { adminFindTag } from "@/server/tags";
import { AdminTagActions, StatusBadge } from "./TagBits";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  await requireAdmin("/admin");
  const q = (await searchParams).q;
  const query = typeof q === "string" ? q.slice(0, 40) : "";
  const db = getDb();
  const [batches, found] = await Promise.all([listBatches(db), query ? adminFindTag(db, query) : null]);

  return (
    <main className="full">
      <p>
        <Link href="/dashboard">← Dashboard</Link>
      </p>
      <div className="row between">
        <h1>Admin</h1>
        <Link className="button" href="/admin/batches/new">
          New batch
        </Link>
      </div>

      <div className="card">
        <h2>Find a tag</h2>
        <form method="get" className="row">
          <input
            name="q"
            defaultValue={query}
            placeholder="Tag ID or public code"
            maxLength={40}
            aria-label="Tag ID or public code"
          />
          <button type="submit" className="secondary">
            Search
          </button>
        </form>
        {query && !found && <p className="muted">No tag matches “{query}”.</p>}
        {found && (
          <table>
            <tbody>
              <tr>
                <th>Tag ID</th>
                <td className="mono">{found.tag.id}</td>
              </tr>
              <tr>
                <th>Public code</th>
                <td className="mono">{found.tag.publicCode}</td>
              </tr>
              <tr>
                <th>Status</th>
                <td>
                  <StatusBadge status={found.tag.status} reason={found.tag.disabledReason} />
                </td>
              </tr>
              <tr>
                <th>Profile</th>
                <td>{found.profile ? PROFILE_TYPE_INFO[found.profile.type].label : "None"}</td>
              </tr>
              <tr>
                <th>Batch</th>
                <td>
                  {found.tag.batchId ? (
                    <Link href={`/admin/batches/${found.tag.batchId}`}>{found.tag.batchId}</Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
              <tr>
                <th>Actions</th>
                <td>
                  <AdminTagActions tagId={found.tag.id} status={found.tag.status} reason={found.tag.disabledReason} />
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Batches</h2>
        {batches.length === 0 ? (
          <p className="muted">No batches yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Form factor</th>
                <th>Claimed</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/admin/batches/${b.id}`}>{b.label}</Link>
                  </td>
                  <td>{FORM_FACTOR_LABEL[b.formFactor]}</td>
                  <td>
                    {b.claimed} / {b.quantity}
                  </td>
                  <td>{b.createdAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
