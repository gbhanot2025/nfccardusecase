import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getServableImage } from "@/server/photos";
import { getStorage } from "@/server/storage";

/** Profile photos and logos. Served only while in use on an active tag (or to their owner). */
export async function GET(_request: Request, ctx: RouteContext<"/media/[...key]">) {
  const { key } = await ctx.params;
  const session = await getSession();
  const image = await getServableImage(getDb(), getStorage(), key.join("/"), session?.user.id ?? null);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(image.body), {
    headers: {
      "Content-Type": image.contentType === "image/webp" ? "image/webp" : "application/octet-stream",
      // Keys are unique per upload; a short cache lets a disabled tag's images disappear soon.
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
