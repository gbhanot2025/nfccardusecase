import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageError, MAX_UPLOAD_BYTES, processImage } from "@/server/images";

async function photoWithGps(width = 2400, height = 1600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: "PhoneMaker", Model: "Phone 15" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" },
    })
    .toBuffer();
}

describe("photo processing", () => {
  it("removes EXIF/GPS metadata, converts to WebP and shrinks to fit", async () => {
    const input = await photoWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processImage(input);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBe(1024);
    expect(Buffer.from(out).includes(Buffer.from("PhoneMaker"))).toBe(false);
  });

  it("doesn't enlarge small images", async () => {
    const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const meta = await sharp(await processImage(small)).metadata();
    expect([meta.width, meta.height]).toEqual([200, 100]);
  });

  it("rejects things that aren't images, SVGs, empty and oversized files", async () => {
    await expect(processImage(Buffer.from("<html>not an image</html>"))).rejects.toThrow(ImageError);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    await expect(processImage(svg)).rejects.toThrow(ImageError);
    await expect(processImage(new Uint8Array())).rejects.toThrow(ImageError);
    await expect(processImage(new Uint8Array(MAX_UPLOAD_BYTES + 1))).rejects.toThrow(ImageError);
  });
});
