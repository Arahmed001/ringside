"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { FighterHit } from "@/lib/fighter-search";
import { countryName, flag } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n";
import { WatchButton } from "@/components/Watch";

function Row({ h }: { h: FighterHit }) {
  const locale = useLocale();
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span className="min-w-0">
        <b className="block truncate">{h.name} <span title={countryName(h.country, locale)} aria-hidden="true">{flag(h.country)}</span></b>
        <span className="text-xs text-muted"><span className="tabular">{h.record}</span> · {h.division}</span>
      </span>
      <WatchButton slug={h.slug} />
    </li>
  );
}

/**
 * Find a fighter and star them without leaving the watchlist: a search box (the same type-ahead the matchup lab uses),
 * and, while the list is empty, a few of the top-rated fighters to start from.
 */
export function WatchlistAdd({ suggestions, showSuggestions }: { suggestions: FighterHit[]; showSuggestions: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ q: string; rows: FighterHit[] } | null>(null);
  const seq = useRef(0);
  const labelId = useId();

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return;
    const id = ++seq.current;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/fighters?q=${encodeURIComponent(q)}&lang=${locale}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: FighterHit[]) => { if (id === seq.current) setResult({ q, rows }); })
        .catch(() => { /* aborted or offline: keep what is showing */ });
    }, 120);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [text, locale]);

  const q = text.trim();
  const answered = q.length >= 2 && result !== null && result.q === q;
  return (
    <section aria-labelledby={labelId} className="space-y-3">
      <h2 id={labelId} className="eyebrow">{t("Add a fighter")}</h2>
      <input
        type="search" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false}
        placeholder={t("Search by name…")} aria-label={t("Search for a fighter to watch")}
        className="w-full max-w-md rounded-xl border border-line bg-panel2 px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-gold/60"
      />
      {answered && (
        result.rows.length
          ? <ul className="card max-w-xl divide-y divide-line/60">{result.rows.map((h) => <Row key={h.slug} h={h} />)}</ul>
          : <p className="text-sm text-muted">{t("No fighter matches that.")}</p>
      )}
      {!answered && showSuggestions && suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted">{t("Or start with the top-rated fighters:")}</p>
          <ul className="card max-w-xl divide-y divide-line/60">{suggestions.map((h) => <Row key={h.slug} h={h} />)}</ul>
        </div>
      )}
    </section>
  );
}
