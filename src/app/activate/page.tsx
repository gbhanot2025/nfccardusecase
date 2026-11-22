import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/require-user";
import { normalizePublicCode } from "@/server/codes";

export const metadata: Metadata = { title: "Activate a tag" };

/**
 * Activation without NFC: the customer types the code printed under the QR code, then (next page)
 * the claim code. Needs an account, like tapping does.
 */
export default async function ActivatePage({ searchParams }: PageProps<"/activate">) {
  await requireUser("/activate");
  const raw = (await searchParams).code;
  const typed = typeof raw === "string" ? raw.trim().slice(0, 40) : "";
  if (typed) {
    const code = normalizePublicCode(typed.replace(/[\s-]/g, ""));
    if (code) redirect(`/activate/${code}`);
  }

  return (
    <main>
      <p>
        <Link href="/dashboard">← Your tags</Link>
      </p>
      <h1>Activate a tag</h1>
      <p className="muted">
        No NFC on your phone? Type the 10-character code printed under the QR code on your tag. You&apos;ll enter the
        claim code from the packaging next.
      </p>
      <div className="card">
        <form method="get">
          {typed && (
            <p className="alert error" role="alert">
              That doesn&apos;t look like a tag code. It has 10 letters and numbers, e.g. AB7K9QXM2Z.
            </p>
          )}
          <label>
            Code under the QR code
            <input
              name="code"
              required
              maxLength={40}
              defaultValue={typed}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="AB7K9QXM2Z"
            />
          </label>
          <button type="submit">Continue</button>
        </form>
      </div>
    </main>
  );
}
