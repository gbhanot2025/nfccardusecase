import "server-only";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "heif", "avif", "gif", "tiff"]);

export class ImageError extends Error {}

/**
 * Re-encode an uploaded photo: decode it (anything that isn't a real image fails here), apply the EXIF
 * rotation, shrink it to fit `size`, and write a fresh WebP. Re-encoding drops all metadata, including
 * the GPS location phones embed, which could otherwise reveal where the owner lives.
 */
export async function processImage(input: Uint8Array, size = 1024): Promise<Uint8Array> {
  if (input.byteLength === 0 || input.byteLength > MAX_UPLOAD_BYTES) throw new ImageError("size");
  let format: string | undefined;
  try {
    // limitInputPixels guards against "decompression bomb" images.
    format = (await sharp(input, { limitInputPixels: 40_000_000 }).metadata()).format;
  } catch {
    throw new ImageError("unreadable");
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) throw new ImageError("format");
  try {
    return await sharp(input, { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate()
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ImageError("unreadable");
  }
}
