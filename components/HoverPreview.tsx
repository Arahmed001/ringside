"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/components/i18n";
import { fighterSlugFromHref } from "@/lib/fighter-link";
import type { FighterCard } from "@/lib/fighter-card";

/**
 * A small card with a fighter's record, rating, rank and last fight when the pointer rests on a link to their page (or keyboard focus does), so a table of names can be read
 * without opening every page. One listener for the whole page, so no link has to be changed. Only where there is a real pointer that can hover (never on a phone); the card
 * appears after a short rest, stays while the pointer is on it or the link, goes on Escape, on scrolling, on leaving, and says nothing the page behind the link does not.
 * It is a tooltip for the link (aria-describedby), holds no controls, and its data is one cached request per fighter.
 */
const REST_MS = 450, GRACE_MS = 180, WIDTH = 288;
const cache = new Map<string, FighterCard | null>();

export function HoverPreview() {
  const t = useT();
  const locale = useLocale();
  const [shown, setShown] = useState<{ slug: string; card: FighterCard; top: number; left: number } | null>(null);
  const timers = useRef<{ rest?: ReturnType<typeof setTimeout>; grace?: ReturnType<typeof setTimeout> }>({});
  const current = useRef<HTMLAnchorElement | null>(null);
  const overCard = useRef(false);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const clear = () => { clearTimeout(timers.current.rest); clearTimeout(timers.current.grace); };
    const hide = () => { clear(); overCard.current = false; if (current.current) current.current.removeAttribute("aria-describedby"); current.current = null; setShown(null); };
    const linkOf = (target: EventTarget | null): HTMLAnchorElement | null => {
      const a = (target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.closest("[data-no-preview], .drawer, [role=dialog], nav")) return null;
      return fighterSlugFromHref(a.href, location.origin) && a.pathname !== location.pathname ? a : null;
    };
    const open = async (a: HTMLAnchorElement) => {
      const slug = fighterSlugFromHref(a.href, location.origin)!;
      let card = cache.get(slug);
      if (card === undefined) {
        try { const r = await fetch(`/api/fighter-card/${slug}?lang=${locale}`); card = r.ok ? ((await r.json()) as FighterCard) : null; } catch { card = null; }
        cache.set(slug, card);
      }
      if (!card || current.current !== a) return; // gone, or the pointer has moved on while it loaded
      const r = a.getBoundingClientRect(), room = window.innerHeight - r.bottom;
      const left = Math.max(8, Math.min(window.innerWidth - WIDTH - 8, r.left + r.width / 2 - WIDTH / 2));
      const top = room > 190 ? r.bottom + 8 : Math.max(8, r.top - 8 - 170);
      a.setAttribute("aria-describedby", "hover-preview");
      setShown({ slug, card, top, left });
    };
    const arm = (a: HTMLAnchorElement) => {
      if (current.current === a) { clearTimeout(timers.current.grace); return; }
      hide(); current.current = a;
      timers.current.rest = setTimeout(() => void open(a), REST_MS);
    };
    const leave = () => { clearTimeout(timers.current.rest); timers.current.grace = setTimeout(() => { if (!overCard.current) hide(); }, GRACE_MS); };
    const onOver = (e: PointerEvent) => { if (e.pointerType === "touch") return; const a = linkOf(e.target); if (a) arm(a); };
    const onOut = (e: PointerEvent) => { if (current.current && linkOf(e.target) === current.current && !current.current.contains(e.relatedTarget as Node | null)) leave(); };
    const onFocus = (e: FocusEvent) => { const a = linkOf(e.target); if (a) arm(a); };
    const onBlur = (e: FocusEvent) => { if (current.current && linkOf(e.target) === current.current) hide(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && current.current) hide(); };
    document.addEventListener("pointerover", onOver); document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocus); document.addEventListener("focusout", onBlur);
    document.addEventListener("keydown", onKey); window.addEventListener("scroll", hide, { passive: true }); document.addEventListener("click", hide, true);
    return () => {
      clear(); document.removeEventListener("pointerover", onOver); document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocus); document.removeEventListener("focusout", onBlur);
      document.removeEventListener("keydown", onKey); window.removeEventListener("scroll", hide); document.removeEventListener("click", hide, true);
    };
  }, [locale]);

  if (!shown) return null;
  const c = shown.card;
  return (
    <div id="hover-preview" role="tooltip" className="card pop-in no-print fixed z-40 p-4 text-sm shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)]" style={{ top: shown.top, left: shown.left, width: WIDTH }}
      onPointerEnter={() => { overCard.current = true; clearTimeout(timers.current.grace); }} onPointerLeave={() => { overCard.current = false; timers.current.grace = setTimeout(() => { current.current?.removeAttribute("aria-describedby"); current.current = null; setShown(null); }, GRACE_MS); }}>
      <div className="font-display text-xl font-bold uppercase leading-tight">{c.name}</div>
      {c.nickname && <div className="font-serif italic text-gold">“{c.nickname}”</div>}
      <div className="mt-0.5 text-xs text-muted">{c.flag} {c.country} · {c.division} · {c.status}</div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div><dt className="text-xs uppercase tracking-widest text-muted">{t("Record")}</dt><dd className="tabular font-semibold" dir="ltr">{c.record}</dd></div>
        <div><dt className="text-xs uppercase tracking-widest text-muted">{t("Rating")}</dt><dd className="tabular font-semibold text-gold">{c.rating}</dd></div>
        <div><dt className="text-xs uppercase tracking-widest text-muted">{t("KO%")}</dt><dd className="tabular font-semibold">{c.koPercent}%</dd></div>
      </dl>
      {(c.rank !== null || c.lastFight) && <div className="mt-3 flex justify-between gap-2 text-xs text-muted">{c.rank !== null && <span>{t("Rank #{n}", { n: c.rank })}</span>}{c.lastFight && <span>{t("Last fight")}: {c.lastFight}</span>}</div>}
    </div>
  );
}
