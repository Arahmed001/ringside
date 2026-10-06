"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A thin gold bar along the top edge while a page is on its way: it starts when an ordinary link to another page of this site is clicked, creeps towards 70 %, and finishes
 * when the address changes. It makes a slow page feel acknowledged. It is decoration for the eyes (aria-hidden); the page itself announces nothing new. A click that opens a
 * new tab, downloads, is modified (ctrl, shift ...) or only moves within the page never starts it, and it gives up by itself after 10 s.
 */
type Phase = "idle" | "run" | "done";
export function NavProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("idle");
  const first = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      setPhase("run");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setPhase("idle"), 10_000);
    };
    document.addEventListener("click", onClick, true); // capture: <Link> has already called preventDefault by the time a bubbling listener runs
    return () => { document.removeEventListener("click", onClick, true); clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    clearTimeout(timer.current);
    setPhase((p) => (p === "run" ? "done" : p));
    timer.current = setTimeout(() => setPhase("idle"), 600);
    return () => clearTimeout(timer.current);
  }, [pathname]);
  return <div className="nav-progress" data-phase={phase} aria-hidden="true" />;
}
