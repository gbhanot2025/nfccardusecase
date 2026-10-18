"use client";
import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // Runs outside React (no router available here); a full page load is fine for this one-off step.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/two-factor");
      },
    }),
    passkeyClient(),
  ],
});
