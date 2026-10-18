import type { Metadata } from "next";
import { TwoFactorForm } from "./TwoFactorForm";

export const metadata: Metadata = { title: "Two-step verification" };

export default function TwoFactorPage() {
  return (
    <main>
      <h1>Two-step verification</h1>
      <p className="muted">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
      <div className="card">
        <TwoFactorForm />
      </div>
    </main>
  );
}
