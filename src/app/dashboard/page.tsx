import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { SignOutButton } from "@/components/SignOutButton";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { FORM_FACTOR_LABEL, PROFILE_TYPE_INFO } from "@/profile-types/registry";
import { listOwnedTags } from "@/server/tags";
import { setTagEnabledAction } from "./actions";

export const metadata: Metadata = { title: "Dashboard" };

const STATUS_TEXT = { unclaimed: "Not activated", active: "Active", disabled: "Turned off" } as const;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  const tags = await listOwnedTags(getDb(), user.id);
  const claimed = (await searchParams).claimed;
  const justClaimed = typeof claimed === "string" && tags.some((t) => t.id === claimed);

  return (
    <main className="wide">
      <div className="row between">
        <div>
          <h1>Your tags</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
        <div className="row">
          {user.role === "admin" && (
            <Link className="button secondary" href="/admin">
              Admin
            </Link>
          )}
          <Link className="button secondary" href="/dashboard/security">
            Security
          </Link>
          <SignOutButton />
        </div>
      </div>

      {justClaimed && (
        <p className="alert success" role="status">
          Your tag is activated and linked to your account.
        </p>
      )}

      {!user.twoFactorEnabled && (
        <p className="alert success" role="status">
          Protect your account: <Link href="/dashboard/security">turn on two-step verification or add a passkey</Link>.
        </p>
      )}

      {tags.length === 0 ? (
        <div className="card">
          <h2>No tags yet</h2>
          <p className="muted">
            Tap your new tag with your phone and enter the claim code from the packaging to link it to this account.
          </p>
        </div>
      ) : (
        <div className="card">
          <ul className="plain" aria-label="Your tags">
            {tags.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>{t.profileType ? PROFILE_TYPE_INFO[t.profileType].label : "No profile"}</strong>
                  <br />
                  <span className="muted">
                    {FORM_FACTOR_LABEL[t.formFactor]} · <span className="mono">{t.publicCode}</span> ·{" "}
                    <span className={`badge ${t.status}`}>
                      {t.disabledReason === "replaced" ? "Replaced" : STATUS_TEXT[t.status]}
                    </span>
                  </span>
                </div>
                <div className="row">
                  {t.status !== "disabled" && (
                    <Link className="button secondary small" href={`/q/${t.publicCode}`}>
                      View page
                    </Link>
                  )}
                  {t.status === "active" && (
                    <form action={setTagEnabledAction} className="inline">
                      <input type="hidden" name="tagId" value={t.id} />
                      <ConfirmSubmit
                        className="small danger"
                        message="Turn this tag off? Anyone who taps or scans it will see that it's no longer active. You can turn it back on later."
                      >
                        Turn off
                      </ConfirmSubmit>
                    </form>
                  )}
                  {t.status === "disabled" && t.disabledReason === "owner" && (
                    <form action={setTagEnabledAction} className="inline">
                      <input type="hidden" name="tagId" value={t.id} />
                      <input type="hidden" name="enable" value="1" />
                      <button type="submit" className="small secondary">
                        Turn on
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="muted">
            Lost a tag? Turn it off here, then tap your replacement tag and choose to move this profile onto it.
          </p>
        </div>
      )}
    </main>
  );
}
