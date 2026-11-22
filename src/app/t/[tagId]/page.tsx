import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimForm } from "@/components/ClaimForm";
import { TagStatusView } from "@/components/TagStatusView";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { checkTap } from "@/server/taps";
import { findTagById, listOwnedTags, movableProfiles } from "@/server/tags";
import { claimAction } from "./actions";

export const metadata: Metadata = { title: "Tag" };

/**
 * NFC tap landing page. Routes by tag state: unclaimed → activation, active → public page,
 * disabled → notice.
 *
 * A genuine tap carries ?picc=…&cmac=… (NTAG 424 SUN). It's verified against the tag's chip UID and
 * the counter must move forward; verified taps are recorded as scans. Claiming doesn't depend on it:
 * the claim code is the secret (and /activate works without NFC), and the sign-up detour drops the
 * one-time parameters anyway.
 */
export default async function TagPage({ params, searchParams }: PageProps<"/t/[tagId]">) {
  const { tagId } = await params;
  const db = getDb();
  const found = await findTagById(db, tagId.toLowerCase());
  if (!found) notFound();
  const { tag, profile } = found;
  const query = await searchParams;
  const tap = await checkTap(db, tag, profile?.id ?? null, { picc: query.picc, cmac: query.cmac });
  if (tap.kind === "unverified") console.warn(`Unverified tap on a tag: ${tap.reason}`);
  const session = await getSession();
  const isOwner = Boolean(session && tag.ownerId === session.user.id);

  if (tag.status !== "unclaimed") {
    return <TagStatusView status={tag.status} profileType={profile?.type ?? null} isOwner={isOwner} tap={tap.kind} />;
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
        <ClaimForm
          action={claimAction.bind(null, tag.id)}
          allowedTypes={tag.allowedTypes}
          movable={movableProfiles(owned, tag.allowedTypes)}
        />
      </div>
    </main>
  );
}
