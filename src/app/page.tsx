import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>{process.env.APP_NAME ?? "Tag Platform"}</h1>
      <p className="muted">
        Tap-to-share profiles for business cards, pets, devices and wallets. Got a new tag? Tap it with your phone to
        activate it, or sign in to manage your tags.
      </p>
      <div className="row">
        <Link className="button" href="/login">
          Log in
        </Link>
        <Link className="button secondary" href="/signup">
          Create account
        </Link>
      </div>
    </main>
  );
}
