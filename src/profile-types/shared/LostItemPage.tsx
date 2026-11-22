import type { ReactNode } from "react";
import "../profile-pages.css";
import { ProfileImage } from "./ProfileImage";

interface LostItemPageProps {
  lostMode: boolean;
  /** Urgent banner heading shown in lost mode. */
  bannerTitle: string;
  bannerText: string;
  title: string;
  intro: string;
  photoUrl?: string;
  photoAlt?: string;
  /** Type-specific details (plain text only). */
  details?: ReactNode;
  /** Shown only in lost mode. */
  reward?: string;
  /** "Message owner" / "Share location" actions (milestone 4). */
  children?: ReactNode;
}

/**
 * Shared layout for lost_pet / lost_device / lost_id public pages. Never receives or shows owner
 * contact details: finders reach the owner through the actions slot (the relay).
 */
export function LostItemPage({
  lostMode,
  bannerTitle,
  bannerText,
  title,
  intro,
  photoUrl,
  photoAlt,
  details,
  reward,
  children,
}: LostItemPageProps) {
  return (
    <main className={lostMode ? "pp pp-lost pp-lost-on" : "pp pp-lost"}>
      {lostMode && (
        <section className="pp-banner" role="alert">
          <p className="pp-banner-title">{bannerTitle}</p>
          <p>{bannerText}</p>
        </section>
      )}
      <article className="pp-card">
        <ProfileImage className="pp-photo" src={photoUrl} alt={photoAlt ?? ""} />
        <h1 className="pp-name">{title}</h1>
        <p className="pp-intro">{intro}</p>
        {details}
        {lostMode && reward && (
          <p className="pp-reward">
            <span className="pp-reward-label">Reward</span> <span className="pp-text">{reward}</span>
          </p>
        )}
      </article>
      {children && (
        <section className="pp-actions" aria-label="Contact the owner">
          {children}
          <p className="pp-privacy">
            The owner&apos;s contact details are kept private. Your message is passed on to them.
          </p>
        </section>
      )}
    </main>
  );
}
