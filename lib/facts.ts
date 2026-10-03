/**
 * Facts about a fighter that a real feed may not have: height, reach, birth year, stance, debut year. They are stored and carried as null when unknown, never
 * guessed, and shown as a dash. These helpers are the one place that says how.
 */
export const DASH = "–";

/** `f(value)` when the fact is known, a dash when it is not. */
export const orDash = <V,>(v: V | null | undefined, f: (x: V) => string | number): string => (v === null || v === undefined ? DASH : String(f(v)));

/** A difference between two facts, or null when either is unknown. */
export const gap = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

/** Whether a number is a usable, known fact. */
export const isKnown = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** The link to an English Wikipedia article by its title (the page only links; no text is copied). */
export const wikipediaUrl = (title: string): string => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/gi, "/")}`;
