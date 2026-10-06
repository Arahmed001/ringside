"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n";
import { Icon } from "@/components/NavIcons";
import { NAV_KEY } from "@/lib/nav";

const WIDE = "(min-width: 1280px)";
/** Open or collapsed right now: the saved choice if there is one, otherwise whatever the screen width gives. */
const isOpen = () => {
  const saved = document.documentElement.dataset.nav;
  return saved ? saved === "expanded" : window.matchMedia(WIDE).matches;
};

/** The button at the foot of the rail. The choice is saved in this browser and applied before the page paints (see the inline script in the layout). */
export function RailToggle() {
  const t = useT();
  const [open, setOpen] = useState<boolean | null>(null); // unknown until mounted, so the server and first client render agree
  useEffect(() => {
    const sync = () => setOpen(isOpen());
    sync();
    const mq = window.matchMedia(WIDE);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const toggle = () => {
    const next = !isOpen();
    document.documentElement.dataset.nav = next ? "expanded" : "collapsed";
    try { localStorage.setItem(NAV_KEY, next ? "expanded" : "collapsed"); } catch { /* private window: it just will not be remembered */ }
    setOpen(next);
  };
  const label = open === false ? t("Expand menu") : t("Collapse menu");
  return (
    <button type="button" onClick={toggle} aria-expanded={open ?? undefined} aria-controls="side-nav" title={label}
      className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-sm text-muted transition hover:bg-panel2 hover:text-ink">
      <Icon name="chevron" className="rail-chevron h-5 w-5 rtl:rotate-180" />
      <span className="rail-collapsible whitespace-nowrap">{label}</span>
    </button>
  );
}

/** Phones and small tablets: a button that opens the same list in a modal drawer (a native <dialog>, so focus, Esc and the page behind are handled by the browser). */
export function MobileMenu({ children, logo }: { children: ReactNode; logo: ReactNode }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { // growing past the phone layout while the drawer is open would leave a modal over the desktop page
    const mq = window.matchMedia("(min-width: 1024px)");
    const close = () => { if (mq.matches) dialog.current?.close(); };
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} aria-label={t("Menu")} aria-haspopup="dialog"
        className="grid h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 place-items-center rounded-xl border border-line bg-panel text-ink transition hover:border-gold/60 lg:hidden">
        <Icon name="menu" />
      </button>
      <dialog ref={dialog} aria-label={t("Menu")}
        onClick={(e) => { if (e.target === dialog.current || (e.target as HTMLElement).closest("a")) dialog.current?.close(); }}
        className="drawer fixed inset-y-0 start-0 m-0 h-dvh max-h-dvh w-72 max-w-[85vw] overflow-y-auto border-e border-line bg-panel p-4 text-ink backdrop:bg-black/60 backdrop:backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          {logo}
          <button type="button" onClick={() => dialog.current?.close()} aria-label={t("Close menu")} className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted hover:text-ink"><Icon name="close" /></button>
        </div>
        {children}
      </dialog>
    </>
  );
}
