"use client";
import { useEffect, useState } from "react";
import { useLocale } from "./i18n";

/** The preview text. Starts with the plain version rendered by the server and swaps in the richer article when one is available. Nothing on screen says which kind the reader has. */
export function PreviewArticle({ id, initial }: { id: number; initial: string[] }) {
  const locale = useLocale();
  const [paragraphs, setParagraphs] = useState(initial);
  useEffect(() => {
    let alive = true;
    fetch(`/api/preview/${id}?lang=${locale}`).then((r) => r.json()).then((j) => { if (alive && Array.isArray(j.paragraphs)) { setParagraphs(j.paragraphs); } }).catch(() => {});
    return () => { alive = false; };
  }, [id, locale]);
  return (
    <div>
      <div className="space-y-4 text-lg leading-relaxed text-ink/90">{paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
    </div>
  );
}
