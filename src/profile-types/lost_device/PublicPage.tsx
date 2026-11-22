import { LostItemPage } from "../shared/LostItemPage";
import type { PublicPageProps } from "../shared/types";
import type { LostDeviceData } from "./schema";

/** Visitor view of a lost_device tag. Owner contact goes through `children` (the relay). */
export function LostDevicePublicPage({ data, lostMode = false, photoUrl, children }: PublicPageProps<LostDeviceData>) {
  return (
    <LostItemPage
      lostMode={lostMode}
      bannerTitle="Please return this device"
      bannerText="Its owner has reported it lost. Please message them below so they can get it back."
      title={data.nickname ?? "Please return this device"}
      intro={
        lostMode
          ? "Thank you for helping this device get home."
          : "This device belongs to someone. If you found it, please message the owner below."
      }
      photoUrl={photoUrl}
      photoAlt={data.nickname ? `Photo of ${data.nickname}` : "Photo of the device"}
      reward={data.reward}
      details={data.returnMessage && <p className="pp-message pp-text">{data.returnMessage}</p>}
    >
      {children}
    </LostItemPage>
  );
}
