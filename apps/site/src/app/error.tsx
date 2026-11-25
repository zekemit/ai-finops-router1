"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">This page could not load.</h1>
      <p className="text-ink-2">Something went wrong while rendering it. Try again, and if it keeps happening, reload the page.</p>
      <button type="button" onClick={reset} className="glass min-h-11 rounded-full px-6 font-medium hover:bg-white/10">
        Try again
      </button>
    </main>
  );
}
