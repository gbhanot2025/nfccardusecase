import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: process.env.APP_NAME ?? "Tag Platform",
    template: `%s · ${process.env.APP_NAME ?? "Tag Platform"}`,
  },
  description: "Activate your NFC tag and manage your profile.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request so each response gets a fresh CSP nonce (see src/proxy.ts).
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
