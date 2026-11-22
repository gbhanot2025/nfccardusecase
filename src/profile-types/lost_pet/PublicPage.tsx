import { LostItemPage } from "../shared/LostItemPage";
import type { PublicPageProps } from "../shared/types";
import { toLostPetPublicData, type LostPetData } from "./schema";
import { formatPhoneInternational } from "../shared/phone";

/**
 * Visitor view of a lost_pet tag. Normal mode shows only the pet's name, photo and breed; lost mode adds
 * the urgent banner, reward, medical notes and vet. Owner contact goes through `children` (the relay).
 */
export function LostPetPublicPage({ data: input, lostMode = false, photoUrl, children }: PublicPageProps<LostPetData>) {
  // Strip private fields (the microchip number) before anything is rendered.
  const data = toLostPetPublicData(input);
  const name = data.petName ?? "This pet";
  const showVet = lostMode && Boolean(data.vetName || data.vetPhone);
  return (
    <LostItemPage
      lostMode={lostMode}
      bannerTitle="I found this pet"
      bannerText={`${name} is lost and their owner is looking for them. Please keep them safe and message the owner below.`}
      title={data.petName ?? "Pet tag"}
      intro={lostMode ? "Thank you for helping me get home." : "Hi! If I seem lost, please let my owner know below."}
      photoUrl={photoUrl}
      photoAlt={data.petName ? `Photo of ${data.petName}` : "Photo of the pet"}
      reward={data.reward}
      note={data.microchipped ? "This pet is microchipped. Any vet or animal shelter can scan it for free." : undefined}
      details={
        Boolean(data.breed || (lostMode && data.medicalNotes) || showVet) && (
          <dl className="pp-details">
            {data.breed && (
              <div>
                <dt>Breed</dt>
                <dd>{data.breed}</dd>
              </div>
            )}
            {lostMode && data.medicalNotes && (
              <div>
                <dt>Medical notes</dt>
                <dd className="pp-text">{data.medicalNotes}</dd>
              </div>
            )}
            {showVet && (
              <div>
                <dt>Vet</dt>
                <dd>
                  {data.vetName && <span className="pp-text">{data.vetName}</span>}
                  {data.vetName && data.vetPhone && " · "}
                  {data.vetPhone && <a href={`tel:${data.vetPhone}`}>{formatPhoneInternational(data.vetPhone)}</a>}
                </dd>
              </div>
            )}
          </dl>
        )
      }
    >
      {children}
    </LostItemPage>
  );
}
