import Link from "next/link";
import { ProfilePublicPage } from "@/profile-types/modules";
import { PROFILE_TYPE_INFO, type ProfileType } from "@/profile-types/registry";
import { createChallenge } from "@/server/altcha";
import { imageUrl } from "@/server/photos";
import { sendFinderMessageAction } from "./finder/actions";
import { FinderMessageForm } from "./finder/FinderMessageForm";

/**
 * What a visitor sees for an active or disabled tag (from /t or /q): the profile type's public page.
 * Lost-item pages never get owner contact details: finders reach the owner through the relay form.
 */
export function TagStatusView({
  status,
  profile,
  publicCode,
  tagId,
  isOwner,
  tap = "none",
}: {
  status: "active" | "disabled";
  profile: { type: ProfileType; data: unknown; lostMode: boolean } | null;
  publicCode: string;
  tagId: string;
  isOwner: boolean;
  /** Result of the NFC tap check (only on /t). */
  tap?: "none" | "verified" | "unverified";
}) {
  if (status === "disabled" || !profile) {
    return (
      <main>
        <h1>This tag is no longer active</h1>
        <p className="muted">Its owner or the issuer has turned it off.</p>
        {isOwner && (
          <p>
            <Link href="/dashboard">Manage your tags</Link>
          </p>
        )}
      </main>
    );
  }

  return (
    <>
      {isOwner && (
        <p className="owner-bar">
          This is your tag. <Link href={`/dashboard/tags/${tagId}`}>Edit profile</Link>
        </p>
      )}
      {tap === "verified" && (
        <p className="tap-note">
          <span className="badge active" data-tap="verified">
            ✓ Genuine tag
          </span>
        </p>
      )}
      {tap === "unverified" && (
        <p className="tap-note muted" data-tap="unverified">
          This link couldn&apos;t be confirmed as a fresh tap from the original tag. If you just tapped a tag, tap it
          again.
        </p>
      )}
      <ProfilePublicPage
        type={profile.type}
        data={profile.data}
        lostMode={profile.lostMode}
        vcardUrl={profile.type === "business_card" ? `/q/${publicCode}/vcard` : undefined}
        photoUrl={imageUrl((profile.data as Record<string, unknown> | null)?.photoKey)}
        logoUrl={imageUrl((profile.data as Record<string, unknown> | null)?.logoKey)}
      >
        {PROFILE_TYPE_INFO[profile.type].lostItem &&
          (isOwner ? (
            <p className="muted">Finders can message you from here. Messages arrive by email and in your dashboard.</p>
          ) : (
            <FinderMessageForm action={sendFinderMessageAction.bind(null, publicCode)} challenge={createChallenge()} />
          ))}
      </ProfilePublicPage>
    </>
  );
}
