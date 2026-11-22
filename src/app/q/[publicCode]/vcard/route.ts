import { getDb } from "@/lib/db";
import { buildVCard, VCARD_CONTENT_TYPE, vcardFilename } from "@/profile-types/business_card/vcard";
import { parseProfileDataFor } from "@/profile-types/modules";
import { findTagByPublicCode } from "@/server/tags";

/** "Save contact" for an active business card: a vCard 3.0 download. Nothing for other types or states. */
export async function GET(_request: Request, ctx: RouteContext<"/q/[publicCode]/vcard">) {
  const { publicCode } = await ctx.params;
  const found = await findTagByPublicCode(getDb(), publicCode);
  if (!found || found.tag.status !== "active" || found.profile?.type !== "business_card") {
    return new Response("Not found", { status: 404 });
  }
  const data = parseProfileDataFor("business_card", found.profile.data);
  return new Response(buildVCard(data, { revision: found.profile.updatedAt }), {
    headers: {
      "Content-Type": VCARD_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${vcardFilename(data)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
