/** Only same-origin paths or https URLs (CSP `img-src 'self'` will further limit what loads). */
export function safeImageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/\\")) return src;
  try {
    return new URL(src).protocol === "https:" ? src : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A plain <img>: next/image adds an inline `style` attribute, which our nonce-based CSP forbids.
 * Sizes come from CSS classes in profile-pages.css.
 */
export function ProfileImage({ src, alt, className }: { src: string | undefined; alt: string; className: string }) {
  const safe = safeImageSrc(src);
  if (!safe) return null;
  // eslint-disable-next-line @next/next/no-img-element -- see comment above
  return <img className={className} src={safe} alt={alt} loading="lazy" decoding="async" />;
}
