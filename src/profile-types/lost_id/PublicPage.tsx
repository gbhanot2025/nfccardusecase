import { LostItemPage } from "../shared/LostItemPage";
import type { PublicPageProps } from "../shared/types";
import type { LostIdData } from "./schema";

/**
 * Visitor view of a lost_id tag. Shows nothing that identifies the owner: no name, no ID or card
 * numbers, no address, no photo. Owner contact goes through `children` (the relay).
 */
export function LostIdPublicPage({ data, lostMode = false, children }: PublicPageProps<LostIdData>) {
  return (
    <LostItemPage
      lostMode={lostMode}
      bannerTitle="You found a lost wallet/ID"
      bannerText="Its owner has reported it lost. Please message them below so they can get it back."
      title="You found a lost wallet/ID"
      intro={
        lostMode
          ? "Thank you for helping. Please keep it safe and don't share what's inside."
          : "This wallet or ID belongs to someone. If you found it, please message the owner below."
      }
      reward={data.reward}
      details={data.returnMessage && <p className="pp-message pp-text">{data.returnMessage}</p>}
    >
      {children}
    </LostItemPage>
  );
}
