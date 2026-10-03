"use client";
import { useEffect, useState } from "react";
import { useLocale, useT } from "./i18n";

/** The preview text. Starts with the plain version rendered by the server and swaps in Claude's article when a key is configured. */
export function PreviewArticle({ id, initial }: { id: number; initial: string[] }) {
  const t = useT();
  const locale = useLocale();
  const [paragraphs, setParagraphs] = useState(initial);
  const [source, setSource] = useState<"ai" | "rules" | "loading">("loading");
  useEffect(() => {
    let alive = true;
    fetch(`/api/preview/${id}?lang=${locale}`).then((r) => r.json()).then((j) => { if (alive && Array.isArray(j.paragraphs)) { setParagraphs(j.paragraphs); setSource(j.source); } }).catch(() => alive && setSource("rules"));
    return () => { alive = false; };
  }, [id, locale]);
  return (
    <div>
      <div className="space-y-4 text-lg leading-relaxed text-ink/90">{paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className={`chip ${source === "ai" ? "!border-gold/50 !text-gold" : ""}`}>{source === "ai" ? t("✦ Written by Claude from the facts on this page") : source === "loading" ? t("Analysing…") : t("Auto-generated from stats")}</span>
        {source === "rules" && <span>{t("Add an ANTHROPIC_API_KEY to enable richer AI previews.")}</span>}
      </div>
    </div>
  );
}
