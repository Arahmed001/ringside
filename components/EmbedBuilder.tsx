"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useT } from "@/components/i18n";
import { embedHeight, embedPath, embedSnippet, EMBED_WIDTH, type EmbedChoice } from "@/lib/embed-code";
import type { FighterHit } from "@/lib/fighter-search";

type Kind = "fighter" | "rankings";
interface Choice { slug: string; name: string }

/** Builds the code for one of the embeddable cards and shows it as it will look (in a frame of this site, which is allowed for /embed pages only). */
export function EmbedBuilder({ base, divisions }: { base: string; divisions: { slug: string; label: string }[] }) {
  const t = useT();
  const pageLocale = useLocale();
  const id = useId();
  const [kind, setKind] = useState<Kind>("fighter");
  const [fighter, setFighter] = useState<Choice | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ q: string; rows: FighterHit[] } | null>(null);
  const [division, setDivision] = useState(divisions[0]?.slug ?? "heavyweight");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [lang, setLang] = useState<"en" | "ar">(pageLocale === "ar" ? "ar" : "en");
  const [rows, setRows] = useState(5);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || (fighter && fighter.name === query)) return;
    const ctl = new AbortController();
    fetch(`/api/fighters?q=${encodeURIComponent(q)}&lang=${pageLocale}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : [])).then((r: FighterHit[]) => setHits({ q, rows: r })).catch(() => {});
    return () => ctl.abort();
  }, [query, fighter, pageLocale]);

  const choice: EmbedChoice = { kind, lang, theme, slug: fighter?.slug, division, rows };
  const path = embedPath(choice), height = embedHeight(choice), code = embedSnippet(base, choice) ?? "";
  const shown = hits && hits.q === query.trim() ? hits.rows : [];

  async function copy() {
    try { await navigator.clipboard.writeText(code); } catch { area.current?.select(); document.execCommand?.("copy"); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  const field = "w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm";
  const label = "eyebrow mb-1 block";
  return (
    <div className="card space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-kind`} className={label}>{t("What to embed")}</label>
          <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={field}>
            <option value="fighter">{t("A fighter card")}</option>
            <option value="rankings">{t("A division's top fighters")}</option>
          </select>
        </div>
        {kind === "fighter" ? (
          <div className="relative">
            <label htmlFor={`${id}-fighter`} className={label}>{t("Fighter")}</label>
            <input id={`${id}-fighter`} value={query} onChange={(e) => { setQuery(e.target.value); setFighter(null); }} placeholder={t("Search for a fighter…")} autoComplete="off" className={field} />
            {shown.length > 0 && !fighter ? (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line bg-panel shadow-xl">
                {shown.map((h) => <li key={h.slug}><button type="button" className="block w-full px-3 py-2 text-start text-sm hover:bg-panel2" onClick={() => { setFighter({ slug: h.slug, name: h.name }); setQuery(h.name); }}>{h.name}</button></li>)}
              </ul>
            ) : null}
          </div>
        ) : (
          <div>
            <label htmlFor={`${id}-division`} className={label}>{t("Division")}</label>
            <select id={`${id}-division`} value={division} onChange={(e) => setDivision(e.target.value)} className={field}>{divisions.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}</select>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-theme`} className={label}>{t("Theme")}</label>
          <select id={`${id}-theme`} value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")} className={field}><option value="dark">{t("Dark")}</option><option value="light">{t("Light")}</option></select>
        </div>
        <div>
          <label htmlFor={`${id}-lang`} className={label}>{t("Language")}</label>
          <select id={`${id}-lang`} value={lang} onChange={(e) => setLang(e.target.value as "en" | "ar")} className={field}><option value="en">English</option><option value="ar">العربية</option></select>
        </div>
        {kind === "rankings" ? (
          <div>
            <label htmlFor={`${id}-rows`} className={label}>{t("Rows")}</label>
            <input id={`${id}-rows`} type="number" min={1} max={10} value={rows} onChange={(e) => setRows(Math.min(10, Math.max(1, Number(e.target.value) || 5)))} className={field} />
          </div>
        ) : null}
      </div>
      {path ? (
        <>
          <div>
            <label htmlFor={`${id}-code`} className={label}>{t("Code to paste")}</label>
            <textarea id={`${id}-code`} ref={area} readOnly value={code} rows={3} dir="ltr" lang="en" onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-xs`} />
            <button type="button" onClick={copy} className="chip mt-2 cursor-pointer transition hover:text-ink" aria-live="polite">{copied ? t("Copied") : t("Copy the code")}</button>
          </div>
          <div>
            <div className={label}>{t("Preview")}</div>
            <iframe key={path} src={path} title={t("Preview")} width={EMBED_WIDTH} height={height} loading="lazy" className="max-w-full rounded-xl border border-line/60" />
          </div>
        </>
      ) : <p className="text-sm text-muted">{t("Choose a fighter to see the card.")}</p>}
    </div>
  );
}
