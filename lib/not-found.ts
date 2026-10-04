import { LOCALES } from "./i18n/config";

/**
 * A visitor who followed an old or mistyped fighter link should land on the fighter they meant, not a dead end. The not-found page is given the path that
 * missed (the proxy sets it), and for a fighter's address turns the slug back into words for the name search, which already forgives a slip.
 */
const MAX = 60;

/** "/boxers/saul-alvarez-x" (or "/ar/boxers/...") to "saul alvarez x"; `null` for any other address, an empty slug, or one too long to be a name. */
export function nameFromPath(pathname: string): string | null {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  if (parts.length && (LOCALES as readonly string[]).includes(parts[0])) parts.shift();
  if (parts.length !== 2 || parts[0] !== "boxers") return null;
  let slug = parts[1];
  try { slug = decodeURIComponent(slug); } catch { return null; }
  const words = slug.replace(/[-_+.]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  return words && words.length <= MAX ? words : null;
}
