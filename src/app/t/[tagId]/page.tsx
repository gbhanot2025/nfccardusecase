import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TagStatusView } from "@/components/TagStatusView";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { findTagById, listOwnedTags, movableProfiles } from "@/server/tags";
import { ClaimForm } from "./ClaimForm";

export const metadata: Metadata = { title: "Tag" };

/**
 * NFC tap landing page. Routes by tag state: unclaimed → activation, active → public page,
 * disabled → notice.
 *
 * TODO(ntag424): verify the SUN parameters (?picc=…&cmac=…) and the tap counter here once the
 * verification module lands. Until then a tap URL is treated like any link: claiming still needs
 * the secret claim code, so this only affects "is this a genuine tap" (scan alerts, milestone 4).
 */
export default async function TagPage({ params }: PageProps<"/t/[tagId]">) {
  const { tagId } = await params;
  const db = getDb();
  const found = await findTagById(db, tagId.toLowerCase());
  if (!found) notFound();
  const { tag, profile } = found;
  const session = await getSession();
  const isOwner = Boolean(session && tag.ownerId === session.user.id);

  if (tag.status !== "unclaimed") {
    return <TagStatusView status={tag.status} profileType={profile?.type ?? null} isOwner={isOwner} />;
  }

  const here = `/t/${tag.id}`;
  if (!session) {
    return (
      <main>
        <h1>Activate your tag</h1>
        <p className="muted">
          This tag is new. Create an account (or log in), then enter the claim code from the packaging to link it to
          you.
        </p>
        <div className="row">
          <Link className="button" href={`/signup?next=${encodeURIComponent(here)}`}>
            Create account
          </Link>
          <Link className="button secondary" href={`/login?next=${encodeURIComponent(here)}`}>
            Log in
          </Link>
        </div>
      </main>
    );
  }

  const owned = await listOwnedTags(db, session.user.id);
  return (
    <main>
      <h1>Activate your tag</h1>
      <p className="muted">Signed in as {session.user.email}. Enter the claim code printed on the packaging insert.</p>
      <div className="card">
        <ClaimForm tagId={tag.id} allowedTypes={tag.allowedTypes} movable={movableProfiles(owned, tag.allowedTypes)} />
      </div>
    </main>
  );
}
