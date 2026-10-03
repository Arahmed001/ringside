"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "./i18n";
import { localePath } from "@/lib/i18n/config";
import type { SearchHit, HitKind } from "@/lib/search";

const GROUPS: { kind: HitKind; label: string }[] = [
  { kind: "page", label: "Go to" }, { kind: "fighter", label: "Fighters" }, { kind: "person", label: "Corners" }, { kind: "event", label: "Events" }, { kind: "org", label: "Gyms & promotions" },
];
const QUICK = [["/rankings", "Rankings"], ["/events", "Events"], ["/compare", "Matchups"], ["/analytics", "Analytics"]] as const;

/** ⌘K / Ctrl+K (or "/") opens one box that searches fighters, corners, events and organisations in both languages. */
export function CommandPalette() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ q: string; hits: SearchHit[] } | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();

  const close = useCallback(() => { setOpen(false); opener.current?.focus(); }, []);
  const show = useCallback(() => { opener.current = document.activeElement as HTMLElement; setOpen(true); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (open) close(); else show(); }
      else if (e.key === "/" && !typing && !open) { e.preventDefault(); show(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, show]);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}&lang=${locale}`, { signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<SearchHit[]>) : []))
        .then((hits) => { setResult({ q: term, hits }); setActive(0); })
        .catch(() => { /* aborted or offline */ });
    }, 120);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q, open, locale]);

  const term = q.trim();
  const answered = result !== null && result.q === term;
  const hits: SearchHit[] = term.length < 2 ? QUICK.map(([href, label]) => ({ kind: "page" as const, title: t(label), href })) : answered ? result.hits : [];
  const go = (h: SearchHit) => { setOpen(false); setQ(""); setResult(null); router.push(localePath(locale, h.href)); };

  if (!open) {
    return (
      <button type="button" onClick={show} aria-label={t("Search everything (Ctrl+K)")}
        className="flex shrink-0 items-center gap-2 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm text-muted transition hover:border-gold/60 hover:text-ink">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span className="hidden sm:inline">{t("Search")}</span><kbd className="hidden rounded border border-line px-1.5 text-[11px] sm:inline" dir="ltr">⌘K</kbd>
      </button>
    );
  }

  let shown = 0;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={t("Search everything")} className="card w-full max-w-xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)]">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search fighters, trainers, events, gyms…")} aria-label={t("Search")}
          role="combobox" aria-expanded aria-controls={`${id}-list`} aria-activedescendant={hits[active] ? `${id}-${active}` : undefined} autoComplete="off" spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active]); }
            else if (e.key === "Escape") { e.preventDefault(); close(); }
          }}
          className="w-full border-b border-line bg-transparent px-5 py-4 text-base outline-none placeholder:text-muted/70" />
        <ul id={`${id}-list`} role="listbox" className="max-h-[50vh] overflow-auto p-2">
          {term.length >= 2 && answered && hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t("Nothing matches that.")}</li>}
          {term.length >= 2 && !answered && <li className="px-3 py-6 text-center text-sm text-muted">{t("Searching…")}</li>}
          {GROUPS.map((g) => {
            const items = hits.map((h, i) => ({ h, i })).filter((x) => x.h.kind === g.kind);
            if (!items.length) return null;
            return (
              <li key={g.kind} role="presentation">
                <div className="eyebrow px-3 pb-1 pt-3">{term.length < 2 && g.kind === "page" ? t("Quick links") : t(g.label)}</div>
                <ul role="presentation">
                  {items.map(({ h, i }) => { shown++; return (
                    <li key={`${h.href}`} id={`${id}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); go(h); }} onMouseEnter={() => setActive(i)}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-panel2" : ""}`}>
                      <span className="min-w-0 truncate font-semibold">{h.title}</span>
                      {h.subtitle && <span className="shrink-0 truncate text-xs text-muted">{h.subtitle}</span>}
                    </li>
                  ); })}
                </ul>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-muted"><span>↑↓ {t("to move")}</span><span>↵ {t("to open")}</span><span>Esc {t("to close")}</span><span className="ms-auto">{shown ? t.n(shown, "{n} result", "{n} results") : ""}</span></div>
      </div>
    </div>
  );
}
