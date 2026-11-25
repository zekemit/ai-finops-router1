import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">That page does not exist.</h1>
      <p className="text-ink-2">The link may be old or mistyped.</p>
      <Link href="/" className="glass inline-flex min-h-11 items-center rounded-full px-6 font-medium hover:bg-white/10">
        Back to the home page
      </Link>
    </main>
  );
}
