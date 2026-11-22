import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { ProfileEditor } from "@/profile-types/modules";
import { FORM_FACTOR_LABEL, PROFILE_TYPE_INFO } from "@/profile-types/registry";
import { getOwnedProfile } from "@/server/profiles";
import { listMessagesForProfile } from "@/server/relay";
import { saveProfileAction, setLostModeAction } from "./actions";

export const metadata: Metadata = { title: "Edit profile" };

export default async function EditProfilePage({ params }: PageProps<"/dashboard/tags/[tagId]">) {
  const { tagId } = await params;
  const user = await requireUser(`/dashboard/tags/${encodeURIComponent(tagId)}`);
  const db = getDb();
  const owned = await getOwnedProfile(db, user.id, tagId);
  if (!owned) notFound();
  const { tag, profile } = owned;
  const info = PROFILE_TYPE_INFO[profile.type];
  const finderMessages = info.lostItem ? await listMessagesForProfile(db, profile.id) : [];

  return (
    <main className="wide">
      <p>
        <Link href="/dashboard">← Your tags</Link>
      </p>
      <div className="row between">
        <div>
          <h1>{info.label}</h1>
          <p className="muted">
            {FORM_FACTOR_LABEL[tag.formFactor]} · <span className="mono">{tag.publicCode}</span>
          </p>
        </div>
        {tag.status === "active" && (
          <Link className="button secondary" href={`/q/${tag.publicCode}`}>
            View public page
          </Link>
        )}
      </div>

      {info.lostItem && (
        <div className={`card ${profile.lostMode ? "lost-on" : ""}`}>
          <h2>{profile.lostMode ? "Lost mode is ON" : "Lost mode is off"}</h2>
          <p className="muted">
            {profile.lostMode
              ? "Anyone who taps or scans this tag sees an urgent 'lost' banner, your reward and the extra details."
              : "Turn this on if it's lost: the page shows an urgent banner, your reward and the extra details."}
          </p>
          <form action={setLostModeAction.bind(null, tag.id)}>
            <input type="hidden" name="lostMode" value={profile.lostMode ? "off" : "on"} />
            <button type="submit" className={profile.lostMode ? "secondary" : "danger"}>
              {profile.lostMode ? "I found it: turn lost mode off" : "It's lost: turn lost mode on"}
            </button>
          </form>
        </div>
      )}

      {info.lostItem && (
        <div className="card">
          <h2>Messages from finders</h2>
          {finderMessages.length === 0 ? (
            <p className="muted">
              No messages yet. When someone finds it, their messages appear here and in your email.
            </p>
          ) : (
            <ul className="plain messages" aria-label="Messages from finders">
              {finderMessages.map((m) => (
                <li key={m.id}>
                  <div>
                    <p className="message-body">{m.body}</p>
                    <p className="muted">
                      {m.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                      {m.finderContact && <> · Contact: {m.finderContact}</>}
                      {m.latitude !== null && m.longitude !== null && (
                        <>
                          {" · "}
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${m.latitude}&mlon=${m.longitude}#map=17/${m.latitude}/${m.longitude}`}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            Location on map
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card">
        <h2>Profile</h2>
        <ProfileEditor type={profile.type} data={profile.data} action={saveProfileAction.bind(null, tag.id)} />
      </div>
    </main>
  );
}
