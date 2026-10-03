"use client";

/**
 * The last resort: the root layout itself failed, so there is no language, no navigation and no stylesheet. It must supply its own document.
 * Both languages are shown because it cannot know which one the visitor was reading. Plain inline styles, nothing that could fail the same way.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const box = { fontFamily: "system-ui, sans-serif", background: "#09090b", color: "#ecebe6", minHeight: "100vh", display: "grid", placeItems: "center", margin: 0, padding: "2rem", textAlign: "center" as const };
  const btn = { background: "#c9261f", color: "#fff", border: 0, borderRadius: 12, padding: "0.7rem 1.6rem", fontSize: "1.1rem", fontWeight: 700, cursor: "pointer", marginTop: "1rem" };
  return (
    <html lang="en">
      <head><title>Ringside</title></head>
      <body style={box}>
        <main role="alert">
          <h1 style={{ fontSize: "2.4rem", margin: "0 0 .5rem" }}>Down for the count</h1>
          <p style={{ color: "#a8a8b3", maxWidth: 420, margin: "0 auto" }}>Something broke on our side. Try again in a moment.</p>
          <p lang="ar" dir="rtl" style={{ color: "#a8a8b3", maxWidth: 420, margin: ".75rem auto 0" }}>حدث خطأ من جانبنا. حاول مرة أخرى بعد قليل.</p>
          <button style={btn} onClick={() => retry()}>Try again · حاول مرة أخرى</button>
          {error.digest && <p style={{ color: "#a8a8b3", fontSize: ".8rem", marginTop: "1.5rem" }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
