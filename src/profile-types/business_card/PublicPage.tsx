import "../profile-pages.css";
import { formatPhoneInternational } from "../shared/phone";
import { ProfileImage } from "../shared/ProfileImage";
import type { PublicPageProps } from "../shared/types";
import {
  EMAIL_LABEL_TEXT,
  PHONE_LABEL_TEXT,
  SOCIAL_NETWORKS,
  isBusinessCardEmpty,
  type BusinessCardData,
} from "./schema";

function displayUrl(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return href;
  }
}

/** Visitor view of a digital business card: full profile plus "Save contact" (vCard). */
export function BusinessCardPublicPage({ data, photoUrl, logoUrl, vcardUrl }: PublicPageProps<BusinessCardData>) {
  if (isBusinessCardEmpty(data)) {
    return (
      <main className="pp pp-business">
        <article className="pp-card pp-empty">
          <h1 className="pp-name">This card isn&apos;t set up yet</h1>
          <p className="pp-intro">Check back soon.</p>
        </article>
      </main>
    );
  }

  const subtitle = [data.title, data.company].filter(Boolean).join(" · ");
  const links = [
    ...(data.website ? [{ key: "website", label: "Website", href: data.website }] : []),
    ...(data.companyUrl ? [{ key: "company", label: data.company ?? "Company", href: data.companyUrl }] : []),
    ...(data.socials ?? []).map((s, i) => ({
      key: `social-${i}`,
      label: SOCIAL_NETWORKS[s.network]?.label ?? "Link",
      href: s.url,
    })),
  ];

  return (
    <main className="pp pp-business">
      <article className="pp-card">
        <header className="pp-header">
          <ProfileImage className="pp-avatar" src={photoUrl} alt={data.name ? `Photo of ${data.name}` : "Photo"} />
          <div>
            <h1 className="pp-name">{data.name ?? data.company}</h1>
            {subtitle && <p className="pp-subtitle">{subtitle}</p>}
          </div>
          <ProfileImage className="pp-logo" src={logoUrl} alt={data.company ? `${data.company} logo` : "Logo"} />
        </header>

        {data.bio && <p className="pp-message pp-text">{data.bio}</p>}

        {vcardUrl && (
          <a className="button pp-save" href={vcardUrl}>
            Save contact
          </a>
        )}

        {((data.phones?.length ?? 0) > 0 || (data.emails?.length ?? 0) > 0) && (
          <ul className="pp-list" aria-label="Contact details">
            {data.phones?.map((p, i) => (
              <li key={`phone-${i}`}>
                <span className="pp-list-label">{PHONE_LABEL_TEXT[p.label]}</span>
                <a href={`tel:${p.number}`}>{formatPhoneInternational(p.number)}</a>
              </li>
            ))}
            {data.emails?.map((e, i) => (
              <li key={`email-${i}`}>
                <span className="pp-list-label">{EMAIL_LABEL_TEXT[e.label]}</span>
                <a href={`mailto:${e.address}`}>{e.address}</a>
              </li>
            ))}
          </ul>
        )}

        {links.length > 0 && (
          <ul className="pp-list" aria-label="Links">
            {links.map((l) => (
              <li key={l.key}>
                <span className="pp-list-label">{l.label}</span>
                <a href={l.href} rel="noopener noreferrer me" target="_blank">
                  {displayUrl(l.href)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>
    </main>
  );
}
