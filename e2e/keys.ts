/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright's types are not available here, see harness.ts */
/** Keyboard-only helpers: walk the tab order and describe every stop, so a flow can assert on what a person without a mouse would meet. */
import { check } from "./harness";

export interface Stop {
  desc: string; tag: string; id: string; href: string; role: string;
  x: number; sx: number; y: number; w: number; h: number; // x is where it is on screen now, sx where it sits in the page's own layout
  ring: boolean;          // a visible focus indicator (outline or shadow)
  focusVisible: boolean;  // the browser treats it as keyboard focus
  covered: boolean;       // something else (a sticky bar) is painted over the middle of it
  inViewport: boolean;
  inside: string;         // "dialog", "header", "main", "nav" ... the landmark it is in
  key: number;            // a number that stays the same for the same element
}

const DESCRIBE = `(async () => {
  const measure = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    window.__keys = window.__keys || new WeakMap(); window.__n = window.__n || 0;
    if (!window.__keys.has(el)) window.__keys.set(el, ++window.__n);
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
    const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    let sx = r.left; for (let q = el.parentElement; q; q = q.parentElement) sx += q.scrollLeft;
    const text = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    const land = el.closest("dialog, [role=dialog]") ? "dialog" : el.closest("header") ? "header" : el.closest("main") ? "main" : el.closest("nav") ? "nav" : el.closest("footer") ? "footer" : "page";
    return { desc: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + " " + text, tag: el.tagName.toLowerCase(), id: el.id, href: el.getAttribute("href") || "", role: el.getAttribute("role") || "",
      x: r.left, sx, y: r.top, w: r.width, h: r.height, ring: !!ring, focusVisible: el.matches(":focus-visible"),
      covered: !!top && top !== el && !el.contains(top) && !top.contains(el),
      inViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth, inside: land, key: window.__keys.get(el) };
  };
  // the ring and the skip link's slide-in are short transitions (they run even under reduced motion): read the focus once they have settled, a frame at a time
  let m = measure();
  for (let i = 0; m && i < 45 && !(m.ring && m.inViewport && !m.covered); i++) { await new Promise((r) => requestAnimationFrame(() => r())); m = measure(); }
  return m;
})()`;

export const describeFocus = (page: any): Promise<Stop | null> => page.evaluate(DESCRIBE);

/** Presses Tab (or Shift+Tab) up to `max` times and returns each stop; stops early when focus leaves the page (the end of the order) or comes back to a stop already seen (a loop). */
export async function tabThrough(page: any, max: number, opts: { shift?: boolean; until?: (s: Stop) => boolean } = {}): Promise<{ stops: Stop[]; ended: "left" | "loop" | "max" | "until" }> {
  const stops: Stop[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(opts.shift ? "Shift+Tab" : "Tab");
    const s: Stop | null = await describeFocus(page);
    if (!s) return { stops, ended: "left" };
    if (seen.has(s.key)) return { stops, ended: "loop" };
    seen.add(s.key); stops.push(s);
    if (opts.until?.(s)) return { stops, ended: "until" };
  }
  return { stops, ended: "max" };
}

/** What must hold for every stop of a tab walk: a visible ring, keyboard focus styling, on screen, not hidden under a sticky bar. */
export function assertGoodStops(stops: Stop[], where: string, opts: { allowCovered?: (s: Stop) => boolean } = {}) {
  check(stops.length > 0, `${where}: nothing could be reached with Tab`);
  const bad = stops.filter((s) => !s.ring || !s.focusVisible || !s.inViewport || (s.covered && !opts.allowCovered?.(s)));
  check(bad.length === 0, `${where}: ${bad.length} of ${stops.length} stops are not properly focused: ${bad.slice(0, 5).map((s) => `${s.desc} [ring=${s.ring} focus-visible=${s.focusVisible} on-screen=${s.inViewport} covered=${s.covered}]`).join("; ")}`);
}

/** Tab order within one row of the page follows the reading direction: left to right in English, right to left in Arabic. (Positions are the layout's, so a strip that scrolls sideways does not confuse it.) */
export function assertRowsFollowDirection(stops: Stop[], rtl: boolean, where: string) {
  const rows = new Map<number, Stop[]>();
  for (const s of stops) { const k = Math.round(s.y / 20); rows.set(k, [...(rows.get(k) ?? []), s]); }
  for (const row of rows.values()) {
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1], cur = row[i];
      const moved = cur.sx + cur.w / 2 - (prev.sx + prev.w / 2);
      check(rtl ? moved <= 1 : moved >= -1, `${where}: in a row of stops, ${cur.desc} comes after ${prev.desc} but is on the ${moved > 0 ? "right" : "left"} (${rtl ? "right to left" : "left to right"} expected)`);
    }
  }
}
