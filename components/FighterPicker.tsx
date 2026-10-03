"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { FighterHit } from "@/lib/fighter-search";
import { countryName, flag } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n";

/**
 * A fighter type-ahead for the matchup lab. It submits the chosen fighter's slug as `name`; if the visitor typed a
 * name without picking (or JavaScript is off) the text goes up as `${name}q` and the server resolves it.
 */
export function FighterPicker({ name, label, initial, minBouts = 0 }: { name: string; label: string; initial?: { slug: string; name: string }; minBouts?: number }) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [result, setResult] = useState<{ q: string; rows: FighterHit[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const seq = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (slug || q.length < 2) return;
    const id = ++seq.current;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/fighters?q=${encodeURIComponent(q)}&min=${minBouts}&lang=${locale}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: FighterHit[]) => { if (id === seq.current) { setResult({ q, rows }); setActive(-1); } })
        .catch(() => { /* aborted or offline: keep what is showing */ });
    }, 120);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [text, slug, minBouts, locale]);

  const pick = (h: FighterHit) => { setSlug(h.slug); setText(h.name); setOpen(false); setResult(null); };
  const answered = result !== null && result.q === text.trim();
  const hits = answered ? result.rows : [];
  const showing = open && !slug && answered;

  return (
    <div className="relative">
      {slug && <input type="hidden" name={name} value={slug} />}
      <input
        type="text" name={slug ? undefined : `${name}q`} value={text} autoComplete="off" spellCheck={false}
        placeholder={t("Fighter {label}…", { label })} aria-label={t("Fighter {label}", { label })}
        role="combobox" aria-expanded={showing} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { setText(e.target.value); setSlug(""); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && showing && active >= 0 && hits[active]) { e.preventDefault(); pick(hits[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className="w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 text-sm outline-none placeholder:text-muted/70 focus:border-gold/60"
      />
      {showing && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-panel shadow-[0_18px_40px_-18px_rgba(0,0,0,.8)]">
          {hits.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">{minBouts ? t("No fighter with {n}+ bouts matches that.", { n: minBouts }) : t("No fighter matches that.")}</li>}
          {hits.map((h, i) => (
            <li key={h.slug} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-panel2" : ""}`}>
              <span className="min-w-0 truncate"><b>{h.name}</b> <span title={countryName(h.country, locale)}>{flag(h.country)}</span></span>
              <span className="shrink-0 text-xs text-muted"><span className="tabular">{h.record}</span> · {h.division}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
