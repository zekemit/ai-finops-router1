"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0a0c10", color: "#e6edf3", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "20vh 24px" }}>
          <h1 style={{ fontSize: 30, fontWeight: 600 }}>This page could not load.</h1>
          <p style={{ color: "#9ba7b4" }}>Something went wrong. Try again, and if it keeps happening, reload the page.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 24px", borderRadius: 999, border: "1px solid rgba(255,255,255,.2)", background: "transparent", color: "inherit", fontSize: 16 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
