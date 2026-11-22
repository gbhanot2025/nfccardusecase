import Link from "next/link";
import { PROFILE_TYPE_INFO, type ProfileType } from "@/profile-types/registry";

/**
 * What a visitor sees for an active or disabled tag. Milestone 3 replaces the active view with
 * each profile type's public page. Shows nothing about the owner.
 */
export function TagStatusView({
  status,
  profileType,
  isOwner,
  tap = "none",
}: {
  status: "active" | "disabled";
  profileType: ProfileType | null;
  isOwner: boolean;
  /** Result of the NFC tap check (only on /t). */
  tap?: "none" | "verified" | "unverified";
}) {
  if (status === "disabled") {
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
    <main>
      <h1>{profileType ? PROFILE_TYPE_INFO[profileType].label : "Tag"}</h1>
      {tap === "verified" && (
        <p className="badge active" data-tap="verified">
          ✓ Genuine tag
        </p>
      )}
      {tap === "unverified" && (
        <p className="muted" data-tap="unverified">
          This link couldn&apos;t be confirmed as a fresh tap from the original tag. If you just tapped a tag, tap it
          again.
        </p>
      )}
      <div className="card">
        <p className="muted">This profile hasn&apos;t been set up yet. Check back soon.</p>
        {isOwner && (
          <p>
            This is your tag. <Link href="/dashboard">Go to your dashboard</Link>.
          </p>
        )}
      </div>
    </main>
  );
}
