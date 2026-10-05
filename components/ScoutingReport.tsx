"use client";
import { useEffect, useState } from "react";
import { useLocale } from "./i18n";

export function ScoutingReport({ slug, initial }: { slug: string; initial: string }) {
  const locale = useLocale();
  const [text, setText] = useState(initial);
  useEffect(() => {
    let alive = true;
    fetch(`/api/scout/${slug}?lang=${locale}`).then((r) => r.json()).then((j) => { if (alive && typeof j.text === "string") setText(j.text); }).catch(() => {});
    return () => { alive = false; };
  }, [slug, locale]);
  return (
    <div>
      <p className="leading-relaxed text-ink/90">{text}</p>
    </div>
  );
}
