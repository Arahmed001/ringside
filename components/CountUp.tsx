"use client";
import { useEffect, useRef } from "react";
import { COUNT_MS, countAt } from "@/lib/count-up";

/**
 * A key figure that counts up once, when the page loads (never on scroll: DESIGN.md). The words in the page are the final figure from the first byte, so crawlers, screen readers,
 * copy and paste and a visitor without scripts all get the real number; the animation only rewrites the visible text for 0.7 s, from 80 % of the figure to the figure, and puts the
 * real text back at the end. A visitor who asks for reduced motion sees nothing move. `suffix` is what follows the figure ("%").
 */
export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = el.current;
    if (!node || !Number.isFinite(value) || value < 10 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const n = countAt(value, now - t0);
      node.textContent = `${n}${suffix}`;
      if (now - t0 < COUNT_MS) raf = requestAnimationFrame(tick); else node.textContent = `${value}${suffix}`;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); node.textContent = `${value}${suffix}`; };
  }, [value, suffix]);
  return <span ref={el}>{value}{suffix}</span>;
}
