import type { Metadata } from "next";
import Link from "next/link";
import { ClaimForm } from "@/components/ClaimForm";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { normalizePublicCode } from "@/server/codes";
import { findTagByPublicCode, listOwnedTags, movableProfiles } from "@/server/tags";
import { claimByCodeAction } from "../actions";

export const metadata: Metadata = { title: "Activate a tag" };

export default async function ActivateCodePage({ params }: PageProps<"/activate/[publicCode]">) {
  const { publicCode } = await params;
  const code = normalizePublicCode(publicCode);
  const user = await requireUser(code ? `/activate/${code}` : "/activate");
  const db = getDb();
  const found = code ? await findTagByPublicCode(db, code) : null;

  if (!found || found.tag.status !== "unclaimed") {
    return (
      <main>
        <h1>Activate a tag</h1>
        <p className="alert error" role="alert">
          {found
            ? "This tag is already activated or turned off. If it's yours, find it in your dashboard."
            : "We couldn't find a tag with that code. Check the code under the QR code and try again."}
        </p>
        <p>
          <Link href="/activate">Try another code</Link> · <Link href="/dashboard">Your tags</Link>
        </p>
      </main>
    );
  }

  const owned = await listOwnedTags(db, user.id);
  return (
    <main>
      <p>
        <Link href="/activate">← Different code</Link>
      </p>
      <h1>Activate your tag</h1>
      <p className="muted">
        Tag <span className="mono">{found.tag.publicCode}</span>. Enter the claim code printed on the packaging insert.
      </p>
      <div className="card">
        <ClaimForm
          action={claimByCodeAction.bind(null, found.tag.publicCode)}
          allowedTypes={found.tag.allowedTypes}
          movable={movableProfiles(owned, found.tag.allowedTypes)}
        />
      </div>
    </main>
  );
}
