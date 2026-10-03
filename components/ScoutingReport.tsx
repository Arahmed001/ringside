"use client";
import { useEffect, useState } from "react";

export function ScoutingReport({ slug, initial }: { slug: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [source, setSource] = useState<"ai" | "rules" | "loading">("loading");
  useEffect(() => {
    let alive = true;
    fetch(`/api/scout/${slug}`).then((r) => r.json()).then((j) => { if (alive) { setText(j.text); setSource(j.source); } }).catch(() => alive && setSource("rules"));
    return () => { alive = false; };
  }, [slug]);
  return (
    <div>
      <p className="leading-relaxed text-ink/90">{text}</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span className={`chip ${source === "ai" ? "!border-gold/50 !text-gold" : ""}`}>{source === "ai" ? "✦ Written by Claude" : source === "loading" ? "Analysing…" : "Auto-generated from stats"}</span>
        {source === "rules" && <span>Add an ANTHROPIC_API_KEY to enable richer AI reports.</span>}
      </div>
    </div>
  );
}
