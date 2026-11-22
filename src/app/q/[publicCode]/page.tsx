import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TagStatusView } from "@/components/TagStatusView";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { recordScanAfterResponse } from "@/server/scan-after";
import { findTagByPublicCode } from "@/server/tags";

export const metadata: Metadata = { title: "Tag" };

/** QR / short-code landing page. Read-only: it never claims or edits a tag (see CLAUDE.md). */
export default async function QrPage({ params }: PageProps<"/q/[publicCode]">) {
  const { publicCode } = await params;
  const found = await findTagByPublicCode(getDb(), publicCode);
  if (!found) notFound();
  const { tag, profile } = found;

  if (tag.status === "unclaimed") {
    return (
      <main>
        <h1>This tag isn&apos;t active yet</h1>
        <p className="muted">
          To activate it, hold the tag against the back of an NFC-enabled phone and follow the steps. You&apos;ll need
          the claim code from the packaging.
        </p>
        <p>
          No NFC on your phone? <Link href={`/activate/${tag.publicCode}`}>Activate with the printed codes</Link>.
        </p>
      </main>
    );
  }

  const session = await getSession();
  const isOwner = Boolean(session && tag.ownerId === session.user.id);
  if (tag.status === "active" && !isOwner) await recordScanAfterResponse(tag.id, "qr");
  return (
    <TagStatusView status={tag.status} profile={profile} publicCode={tag.publicCode} tagId={tag.id} isOwner={isOwner} />
  );
}
