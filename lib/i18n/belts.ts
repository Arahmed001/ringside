import { normalizeDivision } from "../divisions";
import type { T } from "./t";

/**
 * Belt names in Arabic, worked out from their parts. A real league's belts come as `WBC World Super Welterweight Champion`, `WBA Super World Welterweight Champion`,
 * `IBF Interim World Lightweight Champion`, `The Ring Heavyweight Champion` (129 names in 19 shapes in the first real cache): a body, an optional "Super" or "Interim",
 * "World", an optional "Junior", a division, and often "Champion". The division comes from the dictionary (`t(division)`), so it always reads as everywhere else on the site;
 * the body's code stays as written (WBC is how Arabic sports pages print it). The belt is the title ("لقب ..."): "WBC World Welterweight" and "WBC World Welterweight
 * Champion" are the same belt, and both read the same.
 * This is a fallback behind the stored name translations (`t.name`): a name somebody wrote or reviewed always wins. A name that is not one of these shapes is left as written.
 * Machine Arabic: it needs a native reviewer, like the rest (docs/arabic-belts.md).
 */
const SHAPE = /^(?:(WBA|WBC|IBF|WBO)(?: (Super|Interim))? World|(The Ring))\s+(.+?)(?:\s+Champion)?$/;
const BODY_NAMES: Record<string, string> = {
  "World Boxing Association": "الاتحاد العالمي للملاكمة", "World Boxing Council": "المجلس العالمي للملاكمة", "International Boxing Federation": "الاتحاد الدولي للملاكمة",
  "World Boxing Organization": "المنظمة العالمية للملاكمة", "The Ring": "ذا رينغ",
};

/** The Arabic for a sanctioning body's full name (the five a real league names), or null. */
export const bodyNameAr = (en: string): string | null => BODY_NAMES[en] ?? null;

/** The Arabic for a belt's name, or null when it is not one of the shapes above or its division is not one the site knows. `t` is the Arabic translator (for the division's name). */
export function beltNameAr(en: string, t: T): string | null {
  const m = SHAPE.exec(en.trim());
  if (!m) return null;
  const [, code, modifier, ring, rest] = m;
  const division = normalizeDivision(rest);
  if (!division) return null;
  const d = t(division);
  if (ring) return `لقب «ذا رينغ» في ${d}`;
  const mod = modifier === "Interim" ? " المؤقت" : modifier === "Super" ? " «سوبر»" : "";
  return `لقب ${code} العالمي${mod} في ${d}`;
}

/** What `t.name` falls back to in Arabic when no translation is stored: a belt's name, or a sanctioning body's. */
export const deriveName = (en: string, t: T): string | null => (t.locale === "ar" ? bodyNameAr(en) ?? beltNameAr(en, t) : null);
