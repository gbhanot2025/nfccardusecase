import "server-only";
import QRCode from "qrcode";

/** NFC link written to the chip. The encoder appends the NTAG 424 SUN parameters (?picc=…&cmac=…). */
export function tagUrl(baseUrl: string, tagId: string): string {
  return `${baseUrl}/t/${tagId}`;
}

/** Link inside the printed QR code. Read-only: it never claims or edits a tag. */
export function qrUrl(baseUrl: string, publicCode: string): string {
  return `${baseUrl}/q/${publicCode}`;
}

/**
 * QR code as an SVG string. The input is always our own URL (fixed alphabet), and the library
 * emits only <svg>/<path> with presentation attributes, so it is safe to inline and CSP-clean.
 */
export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}
